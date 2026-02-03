// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

#include <arpa/inet.h>
#include <errno.h>
#include <getopt.h>
#include <math.h>
#include <mosquitto.h>
#include <netdb.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#include <cjson/cJSON.h>

#define MAX(a, b)                        ((a) > (b) ? (a) : (b))

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

#define DEFAULT_DIRECTORY                "/opt/tracking-adsb/analyser"
#define DEFAULT_ADSB_HOST                "127.0.0.1"
#define DEFAULT_ADSB_PORT                30003
#define DEFAULT_MQTT_HOST                "127.0.0.1"
#define DEFAULT_MQTT_PORT                1883
#define DEFAULT_MQTT_TOPIC               "adsb/analyser"
#define DEFAULT_MQTT_CLIENT_ID           "adsb_analyser"
#define DEFAULT_MQTT_INTERVAL            300
#define DEFAULT_STATUS_INTERVAL          300
#define DEFAULT_POSITION_LAT             51.501126
#define DEFAULT_POSITION_LON             -0.14239
#define DEFAULT_DISTANCE_MAX_NM          1000.0
#define DEFAULT_ALTITUDE_MAX_FT          75000
#define DEFAULT_ALTITUDE_MIN_FT          -1500
#define DEFAULT_VOXEL_SIZE_HORIZONTAL_NM 2.0
#define DEFAULT_VOXEL_SIZE_VERTICAL_FT   2000.0
//
#define DEFAULT_VOXEL_SAVE_NAME          "adsb_voxel_map.dat"
#define DEFAULT_STATS_SAVE_NAME          "adsb_stats.json"
#define DEFAULT_PERSIST_INTERVAL         (30 * 60)

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

#define MAX_NAME_LENGTH                  256
#define MAX_LINE_LENGTH                  512

#define MAX_AIRCRAFT                     32768
#define HASH_MASK                        (MAX_AIRCRAFT - 1)

#define PRUNE_THRESHOLD                  0.95
#define PRUNE_RATIO                      0.05

#define LOOP_SLEEP                       5
#define MAX_CONSECUTIVE_ERRORS           10
#define MESSAGE_TIMEOUT                  300
#define CONNECTION_RETRY_PERIOD          5

#define VOXEL_MAX_COUNT                  ((1 << 16) - 1)
#define VOXEL_FILE_MAGIC                 0x56585041 // "VXPA" in hex
#define VOXEL_FILE_VERSION               1

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

typedef struct {
    char directory[MAX_NAME_LENGTH];
    char adsb_host[MAX_NAME_LENGTH];
    unsigned short adsb_port;
    char mqtt_host[MAX_NAME_LENGTH];
    unsigned short mqtt_port;
    char mqtt_topic[MAX_NAME_LENGTH];
    time_t interval_mqtt;
    time_t interval_status;
    time_t interval_persist;
    double distance_max_nm;
    int altitude_max_ft;
    double voxel_size_horizontal_nm;
    double voxel_size_vertical_ft;
    double position_lat;
    double position_lon;
    bool debug;
} config_t;

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

typedef struct {
    double lat;
    double lon;
    int altitude_ft;
    double distance_nm;
    time_t timestamp;
} aircraft_posn_t;

typedef struct {
    char icao[7];
    aircraft_posn_t pos, pos_first;
    aircraft_posn_t min_lat_pos, max_lat_pos, min_lon_pos, max_lon_pos, min_alt_pos, max_alt_pos, min_dist_pos, max_dist_pos;
    bool bounds_initialised;
    time_t published;
} aircraft_data_t;

typedef struct {
    aircraft_data_t entries[MAX_AIRCRAFT];
    int count;
    pthread_mutex_t mutex;
} aircraft_list_t;

typedef struct {
    char icao[7];
    aircraft_posn_t pos;
} aircraft_stat_posn_t;

typedef struct {
    unsigned long messages_total;
    unsigned long messages_position;
    unsigned long position_valid;
    unsigned long position_invalid;
    unsigned long published_mqtt;
    unsigned long aircraft_seen;
    aircraft_stat_posn_t distance_max;
    aircraft_stat_posn_t altitude_max;
} aircraft_stat_t;

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

config_t g_config = {
    .directory                = DEFAULT_DIRECTORY,
    .adsb_host                = DEFAULT_ADSB_HOST,
    .adsb_port                = DEFAULT_ADSB_PORT,
    .mqtt_host                = DEFAULT_MQTT_HOST,
    .mqtt_port                = DEFAULT_MQTT_PORT,
    .mqtt_topic               = DEFAULT_MQTT_TOPIC,
    .interval_mqtt            = DEFAULT_MQTT_INTERVAL,
    .interval_status          = DEFAULT_STATUS_INTERVAL,
    .interval_persist         = DEFAULT_PERSIST_INTERVAL,
    .distance_max_nm          = DEFAULT_DISTANCE_MAX_NM,
    .altitude_max_ft          = DEFAULT_ALTITUDE_MAX_FT,
    .voxel_size_horizontal_nm = DEFAULT_VOXEL_SIZE_HORIZONTAL_NM,
    .voxel_size_vertical_ft   = DEFAULT_VOXEL_SIZE_VERTICAL_FT,
    .position_lat             = DEFAULT_POSITION_LAT,
    .position_lon             = DEFAULT_POSITION_LON,
    .debug                    = false,
};
aircraft_list_t g_aircraft_list   = { 0 };
aircraft_stat_t g_aircraft_stat   = { 0 };
aircraft_stat_t g_aircraft_global = { 0 };
volatile bool g_running           = true;
time_t g_last_mqtt                = 0;
time_t g_last_status              = 0;
struct mosquitto *g_mosq          = NULL;

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

bool host_resolve(const char *const hostname, char *const host, const size_t host_size) {
    struct in_addr addr;
    if (inet_aton(hostname, &addr)) {
        snprintf(host, host_size, "%s", hostname);
        return true;
    }
    const struct hostent *he = gethostbyname(hostname);
    if (!he) {
        fprintf(stderr, "failed to resolve hostname: %s\n", hostname);
        return false;
    }
    addr.s_addr = *((in_addr_t *)he->h_addr_list[0]);
    snprintf(host, host_size, "%s", inet_ntoa(addr));
    return true;
}

bool host_parse(const char *const input, char *const host, const size_t host_size, unsigned short *const port, const unsigned short default_port) {
    const char *const colon = strrchr(input, ':');
    if (!colon) {
        snprintf(host, host_size, "%s", input);
        *port = default_port;
    } else {
        const size_t host_len = (size_t)(colon - input);
        if (host_len >= host_size) {
            fprintf(stderr, "host name too long\n");
            return false;
        }
        const unsigned short provided_port = (unsigned short)atoi(colon + 1);
        if (provided_port <= 0) {
            fprintf(stderr, "invalid port number: %s\n", colon + 1);
            return false;
        }
        snprintf(host, host_size, "%.*s", (int)host_len, input);
        *port = provided_port;
    }
    return true;
}

double calculate_distance_nm(const double lat1, const double lon1, const double lat2, const double lon2) {
    const double dlat = (lat2 - lat1) * M_PI / 180.0, dlon = (lon2 - lon1) * M_PI / 180.0;
    const double a = sin(dlat / 2) * sin(dlat / 2) + cos(lat1 * M_PI / 180.0) * cos(lat2 * M_PI / 180.0) * sin(dlon / 2) * sin(dlon / 2);
    const double c = 2 * atan2(sqrt(a), sqrt(1 - a));
    return 3440.065 * c;
}

unsigned int hash_icao(const char *const icao) {
    unsigned int hash = 0;
    for (int i = 0; i < 6 && icao[i]; i++)
        hash = hash * 31 + (unsigned int)icao[i];
    return hash & HASH_MASK;
}

static bool interval_past(time_t *const last, const time_t interval) {
    const time_t now = time(NULL);
    if (*last == 0)
        *last = now;
    else if ((now - *last) >= interval) {
        *last = now;
        return true;
    }
    return false;
}

static bool interval_wait(time_t *const last, const time_t interval, volatile bool *running) {
    const time_t now = time(NULL);
    if (*last == 0)
        *last = now;
    if ((now - *last) < interval && *running) {
        time_t remain = interval - (now - *last);
        while (remain-- > 0 && *running)
            sleep(1);
    }
    *last = time(NULL);
    return *running;
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

const char *mqtt_host;
unsigned short mqtt_port;
char mqtt_host_resolved[MAX_NAME_LENGTH];

bool mqtt_publish(const char *const topic, const unsigned char *const data, const size_t length) {
    if (g_mosq) {
        const int rc = mosquitto_publish(g_mosq, NULL, topic, (int)length, data, 0, false);
        if (rc == MOSQ_ERR_SUCCESS)
            return true;
        printf("mqtt: publish failed: %s\n", mosquitto_strerror(rc));
    }
    return false;
}

void mqtt_on_connect(struct mosquitto *mosq __attribute__((unused)), void *obj __attribute__((unused)), int rc) {
    if (rc == 0)
        printf("mqtt: connection succeeded to %s[%s]:%d\n", mqtt_host, mqtt_host_resolved, mqtt_port);
    else
        printf("mqtt: connection failed to %s[%s]:%d (mosquitto_connect): %s\n", mqtt_host, mqtt_host_resolved, mqtt_port, mosquitto_strerror(rc));
}

bool mqtt_begin(const char *host, const unsigned short port) {
    mqtt_host = host;
    mqtt_port = port;
    if (!host_resolve(host, mqtt_host_resolved, sizeof(mqtt_host_resolved)))
        return false;
    mosquitto_lib_init();
    g_mosq = mosquitto_new(DEFAULT_MQTT_CLIENT_ID, true, NULL);
    if (!g_mosq) {
        mosquitto_lib_cleanup();
        printf("mqtt: connection failed to %s[%s]:%d (mosquitto_new)\n", mqtt_host, mqtt_host_resolved, mqtt_port);
        return false;
    }
    mosquitto_connect_callback_set(g_mosq, mqtt_on_connect);
    const int rc = mosquitto_connect(g_mosq, mqtt_host_resolved, mqtt_port, 60);
    if (rc != MOSQ_ERR_SUCCESS) {
        mosquitto_destroy(g_mosq);
        g_mosq = NULL;
        mosquitto_lib_cleanup();
        printf("mqtt: connection failed to %s[%s]:%d (mosquitto_connect): %s\n", mqtt_host, mqtt_host_resolved, mqtt_port, mosquitto_strerror(rc));
        return false;
    }
    mosquitto_loop_start(g_mosq);
    return true;
}

void mqtt_end(void) {
    if (g_mosq) {
        mosquitto_disconnect(g_mosq);
        mosquitto_loop_stop(g_mosq, true);
        mosquitto_destroy(g_mosq);
        g_mosq = NULL;
        mosquitto_lib_cleanup();
    }
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

typedef unsigned short voxel_data_t;

typedef struct {
    voxel_data_t *data;
    int size_x, size_y, size_z;
    int bits;
    size_t total_voxels;
    double origin_lat, origin_lon;
    double distance_max_nm, altitude_max_ft;
    double horizontal_size_nm, vertical_size_ft;
    char save_path[MAX_LINE_LENGTH];
    bool debug;
} voxel_map_t;

voxel_map_t g_voxel_map = { 0 };

int constrain_int(const int v, const int v_min, const int v_max) { return v < v_min ? v_min : (v > v_max ? v_max : v); }

double voxel_get_memorysize(void) { return (double)(g_voxel_map.total_voxels * sizeof(voxel_data_t)) / (double)(1024 * 1024); }

double voxel_get_occupancy(void) {
    if (!g_voxel_map.data)
        return 0.0;
    size_t occupied = 0;
    for (size_t i = 0; i < g_voxel_map.total_voxels; i++)
        if (g_voxel_map.data[i])
            occupied++;
    return (double)(occupied * 100) / (double)g_voxel_map.total_voxels;
}

void voxel_coords_to_indices(const double lat, const double lon, const double altitude_ft, int *const x, int *const y, int *const z) {
    const double distance_nm = calculate_distance_nm(g_voxel_map.origin_lat, g_voxel_map.origin_lon, lat, lon);
    const double lat1_rad = g_voxel_map.origin_lat * M_PI / 180.0, lat2_rad = lat * M_PI / 180.0, dlon_rad = (lon - g_voxel_map.origin_lon) * M_PI / 180.0;
    const double bearing = atan2(sin(dlon_rad) * cos(lat2_rad), cos(lat1_rad) * sin(lat2_rad) - sin(lat1_rad) * cos(lat2_rad) * cos(dlon_rad));
    const double dx_nm = distance_nm * sin(bearing), dy_nm = distance_nm * cos(bearing);
    *x = constrain_int((int)((dx_nm / g_voxel_map.horizontal_size_nm) + (g_voxel_map.size_x / 2)), 0, g_voxel_map.size_x - 1);
    *y = constrain_int((int)((dy_nm / g_voxel_map.horizontal_size_nm) + (g_voxel_map.size_y / 2)), 0, g_voxel_map.size_y - 1);
    *z = constrain_int((int)((altitude_ft / g_voxel_map.vertical_size_ft)), 0, g_voxel_map.size_z - 1);
}

size_t voxel_indices_to_index(const int x, const int y, const int z) {
    return (size_t)z * (size_t)g_voxel_map.size_x * (size_t)g_voxel_map.size_y + (size_t)y * (size_t)g_voxel_map.size_x + (size_t)x;
}

void voxel_map_update(const double lat, const double lon, const double altitude_ft) {
    if (!g_voxel_map.data)
        return;
    int x, y, z;
    voxel_coords_to_indices(lat, lon, altitude_ft, &x, &y, &z);
    const size_t i = voxel_indices_to_index(x, y, z);
    if (g_voxel_map.data[i] < VOXEL_MAX_COUNT)
        if (g_voxel_map.data[i]++ == 0 && g_voxel_map.debug)
            printf("debug: voxel: created [%d,%d,%d] (%.1fnm, %.1fnm, %.0fft)\n", x, y, z, (x - g_voxel_map.size_x / 2) * g_voxel_map.horizontal_size_nm,
                   (y - g_voxel_map.size_y / 2) * g_voxel_map.horizontal_size_nm, z * g_voxel_map.vertical_size_ft);
}

bool voxel_map_save(void) {
    if (!g_voxel_map.data)
        return false;

    FILE *fp = fopen(g_voxel_map.save_path, "wb");
    if (!fp) {
        printf("voxel: map open file for write failed: %s\n", g_voxel_map.save_path);
        return false;
    }

    const unsigned int magic = VOXEL_FILE_MAGIC, version = VOXEL_FILE_VERSION;
    fwrite(&magic, sizeof(magic), 1, fp);
    fwrite(&version, sizeof(version), 1, fp);
    fwrite(&g_voxel_map.size_x, sizeof(g_voxel_map.size_x), 1, fp);
    fwrite(&g_voxel_map.size_y, sizeof(g_voxel_map.size_y), 1, fp);
    fwrite(&g_voxel_map.size_z, sizeof(g_voxel_map.size_z), 1, fp);
    fwrite(&g_voxel_map.origin_lat, sizeof(g_voxel_map.origin_lat), 1, fp);
    fwrite(&g_voxel_map.origin_lon, sizeof(g_voxel_map.origin_lon), 1, fp);
    fwrite(&g_voxel_map.distance_max_nm, sizeof(g_voxel_map.distance_max_nm), 1, fp);
    fwrite(&g_voxel_map.altitude_max_ft, sizeof(g_voxel_map.altitude_max_ft), 1, fp);
    const size_t wrote = fwrite(g_voxel_map.data, sizeof(voxel_data_t), g_voxel_map.total_voxels, fp);

    fclose(fp);
    if (wrote != g_voxel_map.total_voxels) {
        printf("voxel: map write file failed (wrote %zu of %zu voxels): %s\n", wrote, g_voxel_map.total_voxels, g_voxel_map.save_path);
        return false;
    }

    if (g_voxel_map.debug)
        printf("voxel: map save file to %s (%.1f%% occupied)\n", g_voxel_map.save_path, voxel_get_occupancy());
    return true;
}

bool voxel_map_load(void) {
    if (!g_voxel_map.data)
        return false;

    FILE *fp = fopen(g_voxel_map.save_path, "rb");
    if (!fp) {
        if (errno != ENOENT)
            printf("voxel: map open file for read failed: %s\n", g_voxel_map.save_path);
        return false;
    }

    unsigned int magic, version;
    int size_x, size_y, size_z;
    double origin_lat, origin_lon, distance_max_nm, altitude_max_ft;
    if (fread(&magic, sizeof(magic), 1, fp) != 1 || magic != VOXEL_FILE_MAGIC) {
        printf("voxel: map read file has invalid magic\n");
        fclose(fp);
        return false;
    }
    if (fread(&version, sizeof(version), 1, fp) != 1 || version != VOXEL_FILE_VERSION) {
        printf("voxel: map read file has unsupported version %u\n", version);
        fclose(fp);
        return false;
    }
    if (fread(&size_x, sizeof(size_x), 1, fp) != 1 || fread(&size_y, sizeof(size_y), 1, fp) != 1 || fread(&size_z, sizeof(size_z), 1, fp) != 1 ||
        fread(&origin_lat, sizeof(origin_lat), 1, fp) != 1 || fread(&origin_lon, sizeof(origin_lon), 1, fp) != 1 ||
        fread(&distance_max_nm, sizeof(distance_max_nm), 1, fp) != 1 || fread(&altitude_max_ft, sizeof(altitude_max_ft), 1, fp) != 1) {
        printf("voxel: map read file header incomplete\n");
        fclose(fp);
        return false;
    }
    if (size_x != g_voxel_map.size_x || size_y != g_voxel_map.size_y || size_z != g_voxel_map.size_z || fabs(origin_lat - g_voxel_map.origin_lat) > 0.0001 ||
        fabs(origin_lon - g_voxel_map.origin_lon) > 0.0001) {
        printf("voxel: map read file has mismatched dimensions or origin\n");
        fclose(fp);
        return false;
    }
    const size_t read = fread(g_voxel_map.data, sizeof(voxel_data_t), g_voxel_map.total_voxels, fp);

    fclose(fp);

    if (read != g_voxel_map.total_voxels) {
        printf("voxel: map read file failed (read %zu of %zu voxels): %s\n", read, g_voxel_map.total_voxels, g_voxel_map.save_path);
        return false;
    }

    printf("voxel: map load file from %s (%.1f%% occupied)\n", g_voxel_map.save_path, voxel_get_occupancy());
    return true;
}

bool voxel_map_begin(void) {
    snprintf(g_voxel_map.save_path, sizeof(g_voxel_map.save_path), "%s/%s", g_config.directory, DEFAULT_VOXEL_SAVE_NAME);
    g_voxel_map.debug              = g_config.debug;
    g_voxel_map.distance_max_nm    = g_config.distance_max_nm;
    g_voxel_map.altitude_max_ft    = g_config.altitude_max_ft;
    g_voxel_map.horizontal_size_nm = g_config.voxel_size_horizontal_nm;
    g_voxel_map.vertical_size_ft   = g_config.voxel_size_vertical_ft;
    g_voxel_map.origin_lat         = g_config.position_lat;
    g_voxel_map.origin_lon         = g_config.position_lon;
    //
    g_voxel_map.size_x       = (int)((g_voxel_map.distance_max_nm * 2.0) / g_voxel_map.horizontal_size_nm) + 1;
    g_voxel_map.size_y       = (int)((g_voxel_map.distance_max_nm * 2.0) / g_voxel_map.horizontal_size_nm) + 1;
    g_voxel_map.size_z       = (int)(g_voxel_map.altitude_max_ft / g_voxel_map.vertical_size_ft) + 1;
    g_voxel_map.bits         = sizeof(voxel_data_t) * 8;
    g_voxel_map.total_voxels = (size_t)g_voxel_map.size_x * (size_t)g_voxel_map.size_y * (size_t)g_voxel_map.size_z;
    g_voxel_map.data         = (voxel_data_t *)calloc(g_voxel_map.total_voxels, sizeof(voxel_data_t));
    if (!g_voxel_map.data) {
        printf("voxel: failed to allocate memory for %zu voxels (%.1f MB)\n", g_voxel_map.total_voxels, voxel_get_memorysize());
        return false;
    }
    printf("voxel: initialised using %.0fnm/%.0fft boxes to %.0fnm radius and %.0fft altitude at %d bits = %.0fK voxels (%.1f MB)\n",
           g_voxel_map.horizontal_size_nm, g_voxel_map.vertical_size_ft, g_voxel_map.distance_max_nm, g_voxel_map.altitude_max_ft, g_voxel_map.bits,
           (double)g_voxel_map.total_voxels / (double)(1024 * 1024), voxel_get_memorysize());
    voxel_map_load();
    return true;
}

void voxel_map_end(void) {
    if (g_voxel_map.data) {
        free(g_voxel_map.data);
        g_voxel_map.data = NULL;
    }
}

bool voxel_get_stats(size_t *occupied, size_t *total, double *occupancy) {
    *occupied  = 0;
    *total     = 0;
    *occupancy = 0.0;
    if (!g_voxel_map.data)
        return false;
    *total = g_voxel_map.total_voxels;
    for (size_t i = 0; i < g_voxel_map.total_voxels; i++)
        if (g_voxel_map.data[i])
            (*occupied)++;
    *occupancy = (double)(*occupied * 100) / (double)g_voxel_map.total_voxels;
    return true;
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

bool coordinates_are_valid(const double lat, const double lon) { return (lat >= -90.0 && lat <= 90.0 && lon >= -180.0 && lon <= 180.0); }

bool position_is_valid(const double lat, const double lon, const int altitude_ft, const double distance_nm, const int altitude_max_ft,
                       const double distance_max_nm) {
    return coordinates_are_valid(lat, lon) && (altitude_ft >= DEFAULT_ALTITUDE_MIN_FT && altitude_ft <= altitude_max_ft) && (distance_nm <= distance_max_nm);
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

char g_stats_save_path[MAX_LINE_LENGTH];

static cJSON *aircraft_stats_encode_position(const aircraft_posn_t *const pos) {
    cJSON *obj = cJSON_CreateObject();
    if (!obj)
        return NULL;
    cJSON_AddNumberToObject(obj, "lat", pos->lat);
    cJSON_AddNumberToObject(obj, "lon", pos->lon);
    cJSON_AddNumberToObject(obj, "altitude_ft", pos->altitude_ft);
    cJSON_AddNumberToObject(obj, "distance_nm", pos->distance_nm);
    cJSON_AddNumberToObject(obj, "timestamp", (double)pos->timestamp);
    return obj;
}

static cJSON *aircraft_stats_encode_stat_position(const aircraft_stat_posn_t *const sp) {
    cJSON *obj = cJSON_CreateObject();
    if (!obj)
        return NULL;
    cJSON_AddStringToObject(obj, "icao", sp->icao);
    cJSON *pos = aircraft_stats_encode_position(&sp->pos);
    if (pos)
        cJSON_AddItemToObject(obj, "pos", pos);
    return obj;
}

static cJSON *aircraft_stats_encode_stat(const aircraft_stat_t *const stat) {
    cJSON *obj = cJSON_CreateObject();
    if (!obj)
        return NULL;
    cJSON_AddNumberToObject(obj, "messages_total", (double)stat->messages_total);
    cJSON_AddNumberToObject(obj, "messages_position", (double)stat->messages_position);
    cJSON_AddNumberToObject(obj, "position_valid", (double)stat->position_valid);
    cJSON_AddNumberToObject(obj, "position_invalid", (double)stat->position_invalid);
    cJSON_AddNumberToObject(obj, "published_mqtt", (double)stat->published_mqtt);
    cJSON_AddNumberToObject(obj, "aircraft_seen", (double)stat->aircraft_seen);
    cJSON *distance_max = aircraft_stats_encode_stat_position(&stat->distance_max);
    if (distance_max)
        cJSON_AddItemToObject(obj, "distance_max", distance_max);
    cJSON *altitude_max = aircraft_stats_encode_stat_position(&stat->altitude_max);
    if (altitude_max)
        cJSON_AddItemToObject(obj, "altitude_max", altitude_max);
    return obj;
}

static bool aircraft_stats_decode_position(const cJSON *const obj, aircraft_posn_t *const pos) {
    if (!obj || !cJSON_IsObject(obj))
        return false;
    const cJSON *lat       = cJSON_GetObjectItem(obj, "lat");
    const cJSON *lon       = cJSON_GetObjectItem(obj, "lon");
    const cJSON *alt       = cJSON_GetObjectItem(obj, "altitude_ft");
    const cJSON *dist      = cJSON_GetObjectItem(obj, "distance_nm");
    const cJSON *timestamp = cJSON_GetObjectItem(obj, "timestamp");
    if (lat && cJSON_IsNumber(lat))
        pos->lat = lat->valuedouble;
    if (lon && cJSON_IsNumber(lon))
        pos->lon = lon->valuedouble;
    if (alt && cJSON_IsNumber(alt))
        pos->altitude_ft = (int)alt->valuedouble;
    if (dist && cJSON_IsNumber(dist))
        pos->distance_nm = dist->valuedouble;
    if (timestamp && cJSON_IsNumber(timestamp))
        pos->timestamp = (time_t)timestamp->valuedouble;
    return true;
}

static bool aircraft_stats_decode_stat_position(const cJSON *const obj, aircraft_stat_posn_t *const sp) {
    if (!obj || !cJSON_IsObject(obj))
        return false;
    const cJSON *icao = cJSON_GetObjectItem(obj, "icao");
    const cJSON *pos  = cJSON_GetObjectItem(obj, "pos");
    if (icao && cJSON_IsString(icao)) {
        strncpy(sp->icao, icao->valuestring, 6);
        sp->icao[6] = '\0';
    }
    if (pos)
        aircraft_stats_decode_position(pos, &sp->pos);
    return true;
}

static bool aircraft_stats_decode_stat(const cJSON *const obj, aircraft_stat_t *const stat) {
    if (!obj || !cJSON_IsObject(obj))
        return false;
    const cJSON *messages_total    = cJSON_GetObjectItem(obj, "messages_total");
    const cJSON *messages_position = cJSON_GetObjectItem(obj, "messages_position");
    const cJSON *position_valid    = cJSON_GetObjectItem(obj, "position_valid");
    const cJSON *position_invalid  = cJSON_GetObjectItem(obj, "position_invalid");
    const cJSON *published_mqtt    = cJSON_GetObjectItem(obj, "published_mqtt");
    const cJSON *aircraft_seen     = cJSON_GetObjectItem(obj, "aircraft_seen");
    const cJSON *distance_max      = cJSON_GetObjectItem(obj, "distance_max");
    const cJSON *altitude_max      = cJSON_GetObjectItem(obj, "altitude_max");
    if (messages_total && cJSON_IsNumber(messages_total))
        stat->messages_total = (unsigned long)messages_total->valuedouble;
    if (messages_position && cJSON_IsNumber(messages_position))
        stat->messages_position = (unsigned long)messages_position->valuedouble;
    if (position_valid && cJSON_IsNumber(position_valid))
        stat->position_valid = (unsigned long)position_valid->valuedouble;
    if (position_invalid && cJSON_IsNumber(position_invalid))
        stat->position_invalid = (unsigned long)position_invalid->valuedouble;
    if (published_mqtt && cJSON_IsNumber(published_mqtt))
        stat->published_mqtt = (unsigned long)published_mqtt->valuedouble;
    if (aircraft_seen && cJSON_IsNumber(aircraft_seen))
        stat->aircraft_seen = (unsigned long)aircraft_seen->valuedouble;
    if (distance_max)
        aircraft_stats_decode_stat_position(distance_max, &stat->distance_max);
    if (altitude_max)
        aircraft_stats_decode_stat_position(altitude_max, &stat->altitude_max);
    return true;
}

bool aircraft_stats_save(void) {
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        printf("stats: failed to create JSON object\n");
        return false;
    }

    cJSON_AddNumberToObject(root, "version", 1);
    cJSON_AddNumberToObject(root, "saved_at", (double)time(NULL));

    cJSON *global = aircraft_stats_encode_stat(&g_aircraft_global);
    if (global)
        cJSON_AddItemToObject(root, "global", global);

    char *json_str = cJSON_Print(root);
    cJSON_Delete(root);
    if (!json_str) {
        printf("stats: failed to serialise JSON\n");
        return false;
    }

    FILE *fp = fopen(g_stats_save_path, "w");
    if (!fp) {
        printf("stats: failed to open file for write: %s\n", g_stats_save_path);
        free(json_str);
        return false;
    }
    fprintf(fp, "%s\n", json_str);
    fclose(fp);
    free(json_str);

    if (g_config.debug)
        printf("stats: saved to %s\n", g_stats_save_path);
    return true;
}

bool aircraft_stats_load(void) {
    FILE *fp = fopen(g_stats_save_path, "r");
    if (!fp) {
        if (errno != ENOENT)
            printf("stats: failed to open file for read: %s\n", g_stats_save_path);
        return false;
    }

    fseek(fp, 0, SEEK_END);
    const long file_size = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    if (file_size <= 0 || file_size > 1024 * 1024) {
        printf("stats: invalid file size: %ld\n", file_size);
        fclose(fp);
        return false;
    }

    char *json_str = (char *)malloc((size_t)file_size + 1);
    if (!json_str) {
        printf("stats: failed to allocate memory for file read\n");
        fclose(fp);
        return false;
    }

    const size_t read = fread(json_str, 1, (size_t)file_size, fp);
    fclose(fp);
    json_str[read] = '\0';

    cJSON *root = cJSON_Parse(json_str);
    free(json_str);
    if (!root) {
        printf("stats: failed to parse JSON: %s\n", cJSON_GetErrorPtr());
        return false;
    }

    const cJSON *global = cJSON_GetObjectItem(root, "global");
    if (global)
        aircraft_stats_decode_stat(global, &g_aircraft_global);

    cJSON_Delete(root);
    printf("stats: loaded from %s\n", g_stats_save_path);
    return true;
}

bool aircraft_begin(void) {
    snprintf(g_stats_save_path, sizeof(g_stats_save_path), "%s/%s", g_config.directory, DEFAULT_STATS_SAVE_NAME);
    if (pthread_mutex_init(&g_aircraft_list.mutex, NULL) != 0) {
        perror("pthread_mutex_init");
        return false;
    }
    aircraft_stats_load();
    return true;
}

void aircraft_end(void) { pthread_mutex_destroy(&g_aircraft_list.mutex); }

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

void position_record_set(aircraft_posn_t *const r, const double lat, const double lon, const int altitude_ft, const double distance_nm,
                         const time_t timestamp) {
    r->lat         = lat;
    r->lon         = lon;
    r->altitude_ft = altitude_ft;
    r->distance_nm = distance_nm;
    r->timestamp   = timestamp;
}

void position_stat_record_set(aircraft_stat_posn_t *const r, const double lat, const double lon, const int altitude_ft, const double distance_nm,
                              const time_t timestamp, const char *const icao) {
    position_record_set(&r->pos, lat, lon, altitude_ft, distance_nm, timestamp);
    strncpy(r->icao, icao, 6);
    r->icao[6] = '\0';
}

aircraft_data_t *aircraft_find_or_create(const char *const icao) {
    unsigned int index = hash_icao(icao), index_original = index;

    while (g_aircraft_list.entries[index].icao[0] != '\0') {
        if (strcmp(g_aircraft_list.entries[index].icao, icao) == 0)
            return &g_aircraft_list.entries[index];
        if ((index = (index + 1) & HASH_MASK) == index_original)
            return NULL;
    }

    if (g_aircraft_list.count >= (int)(MAX_AIRCRAFT * PRUNE_THRESHOLD)) {
        int to_remove      = (int)(MAX_AIRCRAFT * PRUNE_RATIO);
        time_t oldest_time = time(NULL);
        if (g_config.debug)
            printf("debug: aircraft map: pruning %d oldest entries\n", to_remove);
        while (to_remove > 0) {
            int oldest_idx = -1;
            oldest_time    = time(NULL);
            for (int i = 0; i < MAX_AIRCRAFT; i++)
                if (g_aircraft_list.entries[i].icao[0] != '\0' && g_aircraft_list.entries[i].pos.timestamp < oldest_time) {
                    oldest_time = g_aircraft_list.entries[i].pos.timestamp;
                    oldest_idx  = i;
                }
            if (oldest_idx >= 0) {
                g_aircraft_list.entries[oldest_idx].icao[0] = '\0';
                g_aircraft_list.count--;
                to_remove--;
            } else
                break;
        }
    }

    strncpy(g_aircraft_list.entries[index].icao, icao, 6);
    g_aircraft_list.entries[index].icao[6]            = '\0';
    g_aircraft_list.entries[index].bounds_initialised = false;
    g_aircraft_list.count++;
    g_aircraft_stat.aircraft_seen++;
    g_aircraft_global.aircraft_seen++;

    return &g_aircraft_list.entries[index];
}

void aircraft_position_update(const char *const icao, const double lat, const double lon, const int altitude_ft, const time_t timestamp) {
    const double distance_nm = calculate_distance_nm(g_config.position_lat, g_config.position_lon, lat, lon);

    if (!position_is_valid(lat, lon, altitude_ft, distance_nm, g_config.altitude_max_ft, g_config.distance_max_nm)) {
        g_aircraft_stat.position_invalid++;
        g_aircraft_global.position_invalid++;
        if (g_config.debug)
            printf("debug: aircraft position: invalid (icao=%s, lat=%.6f, lon=%.6f, alt=%d, dist=%.1f)\n", icao, lat, lon, altitude_ft, distance_nm);
        return;
    }

    g_aircraft_stat.position_valid++;
    g_aircraft_global.position_valid++;

    voxel_map_update(lat, lon, altitude_ft);

    pthread_mutex_lock(&g_aircraft_list.mutex);
    aircraft_data_t *const aircraft = aircraft_find_or_create(icao);
    if (!aircraft) {
        pthread_mutex_unlock(&g_aircraft_list.mutex);
        printf("error: hash table full, cannot add %s\n", icao);
        return;
    }
    position_record_set(&aircraft->pos, lat, lon, altitude_ft, distance_nm, timestamp);
    if (!aircraft->bounds_initialised) {
        position_record_set(&aircraft->pos_first, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->min_lat_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->max_lat_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->min_lon_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->max_lon_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->min_alt_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->max_alt_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->min_dist_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        position_record_set(&aircraft->max_dist_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        aircraft->bounds_initialised = true;
        if (g_config.debug)
            printf("debug: aircraft first seen: %s at %.6f,%.6f alt=%d dist=%.1fnm\n", icao, lat, lon, altitude_ft, distance_nm);
    } else {
        if (lat < aircraft->min_lat_pos.lat)
            position_record_set(&aircraft->min_lat_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        if (lat > aircraft->max_lat_pos.lat)
            position_record_set(&aircraft->max_lat_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        if (lon < aircraft->min_lon_pos.lon)
            position_record_set(&aircraft->min_lon_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        if (lon > aircraft->max_lon_pos.lon)
            position_record_set(&aircraft->max_lon_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        if (altitude_ft < aircraft->min_alt_pos.altitude_ft)
            position_record_set(&aircraft->min_alt_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        if (altitude_ft > aircraft->max_alt_pos.altitude_ft)
            position_record_set(&aircraft->max_alt_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        if (distance_nm < aircraft->min_dist_pos.distance_nm)
            position_record_set(&aircraft->min_dist_pos, lat, lon, altitude_ft, distance_nm, timestamp);
        if (distance_nm > aircraft->max_dist_pos.distance_nm)
            position_record_set(&aircraft->max_dist_pos, lat, lon, altitude_ft, distance_nm, timestamp);
    }
    pthread_mutex_unlock(&g_aircraft_list.mutex);

    if (distance_nm > g_aircraft_stat.distance_max.pos.distance_nm)
        position_stat_record_set(&g_aircraft_stat.distance_max, lat, lon, altitude_ft, distance_nm, timestamp, icao);
    if (distance_nm > g_aircraft_global.distance_max.pos.distance_nm)
        position_stat_record_set(&g_aircraft_global.distance_max, lat, lon, altitude_ft, distance_nm, timestamp, icao);

    if (altitude_ft > g_aircraft_stat.altitude_max.pos.altitude_ft)
        position_stat_record_set(&g_aircraft_stat.altitude_max, lat, lon, altitude_ft, distance_nm, timestamp, icao);
    if (altitude_ft > g_aircraft_global.altitude_max.pos.altitude_ft)
        position_stat_record_set(&g_aircraft_global.altitude_max, lat, lon, altitude_ft, distance_nm, timestamp, icao);
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

static cJSON *aircraft_publish_encode_position(const aircraft_posn_t *const pos) {
    cJSON *obj = cJSON_CreateObject();
    if (!obj)
        return NULL;
    cJSON_AddNumberToObject(obj, "lat", pos->lat);
    cJSON_AddNumberToObject(obj, "lon", pos->lon);
    cJSON_AddNumberToObject(obj, "alt", pos->altitude_ft);
    cJSON_AddNumberToObject(obj, "dist", pos->distance_nm);
    cJSON_AddNumberToObject(obj, "time", (double)pos->timestamp);
    return obj;
}

static cJSON *aircraft_publish_encode_aircraft(const aircraft_data_t *const ac) {
    cJSON *obj = cJSON_CreateObject();
    if (!obj)
        return NULL;

    cJSON_AddStringToObject(obj, "icao", ac->icao);

    cJSON *current = aircraft_publish_encode_position(&ac->pos);
    if (current)
        cJSON_AddItemToObject(obj, "current", current);

    cJSON *first = aircraft_publish_encode_position(&ac->pos_first);
    if (first)
        cJSON_AddItemToObject(obj, "first", first);

    cJSON *bounds = cJSON_CreateObject();
    if (bounds) {
        cJSON *min_lat = aircraft_publish_encode_position(&ac->min_lat_pos);
        if (min_lat)
            cJSON_AddItemToObject(bounds, "min_lat", min_lat);
        cJSON *max_lat = aircraft_publish_encode_position(&ac->max_lat_pos);
        if (max_lat)
            cJSON_AddItemToObject(bounds, "max_lat", max_lat);
        cJSON *min_lon = aircraft_publish_encode_position(&ac->min_lon_pos);
        if (min_lon)
            cJSON_AddItemToObject(bounds, "min_lon", min_lon);
        cJSON *max_lon = aircraft_publish_encode_position(&ac->max_lon_pos);
        if (max_lon)
            cJSON_AddItemToObject(bounds, "max_lon", max_lon);
        cJSON *min_alt = aircraft_publish_encode_position(&ac->min_alt_pos);
        if (min_alt)
            cJSON_AddItemToObject(bounds, "min_alt", min_alt);
        cJSON *max_alt = aircraft_publish_encode_position(&ac->max_alt_pos);
        if (max_alt)
            cJSON_AddItemToObject(bounds, "max_alt", max_alt);
        cJSON *min_dist = aircraft_publish_encode_position(&ac->min_dist_pos);
        if (min_dist)
            cJSON_AddItemToObject(bounds, "min_dist", min_dist);
        cJSON *max_dist = aircraft_publish_encode_position(&ac->max_dist_pos);
        if (max_dist)
            cJSON_AddItemToObject(bounds, "max_dist", max_dist);
        cJSON_AddItemToObject(obj, "bounds", bounds);
    }

    return obj;
}

void aircraft_publish_mqtt(void) {
    const time_t now                          = time(NULL);
    unsigned long published_cnt               = 0;
    unsigned char published_set[MAX_AIRCRAFT] = { 0 };

    cJSON *root = cJSON_CreateObject();
    if (!root)
        return;

    cJSON_AddNumberToObject(root, "timestamp", (double)now);
    cJSON_AddNumberToObject(root, "position_lat", g_config.position_lat);
    cJSON_AddNumberToObject(root, "position_lon", g_config.position_lon);

    cJSON *aircraft_array = cJSON_CreateArray();
    if (!aircraft_array) {
        cJSON_Delete(root);
        return;
    }

    pthread_mutex_lock(&g_aircraft_list.mutex);
    for (int i = 0; i < MAX_AIRCRAFT; i++) {
        if (g_aircraft_list.entries[i].icao[0] != '\0')
            if (g_aircraft_list.entries[i].published < g_aircraft_list.entries[i].pos.timestamp && g_aircraft_list.entries[i].bounds_initialised) {
                cJSON *ac_json = aircraft_publish_encode_aircraft(&g_aircraft_list.entries[i]);
                if (ac_json) {
                    cJSON_AddItemToArray(aircraft_array, ac_json);
                    published_cnt++;
                    published_set[i]++;
                }
            }
    }
    pthread_mutex_unlock(&g_aircraft_list.mutex);

    cJSON_AddItemToObject(root, "aircraft", aircraft_array);

    char *json_str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (json_str && published_cnt > 0) {
        if (mqtt_publish(g_config.mqtt_topic, (const unsigned char *)json_str, strlen(json_str))) {
            g_aircraft_stat.published_mqtt += published_cnt;
            g_aircraft_global.published_mqtt += published_cnt;
            for (int i = 0; i < MAX_AIRCRAFT; i++)
                if (published_set[i])
                    g_aircraft_list.entries[i].published = now;
        }
    }

    if (json_str)
        free(json_str);
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

bool adsb_parse_sbs_position(const char *const line, char *const icao, double *const lat, double *const lon, int *const alt) {
#define ADSB_MAX_FIELDS_DECODE   18
#define ADSB_MIN_FIELDS_REQUIRED 16
    const char *fields[ADSB_MAX_FIELDS_DECODE], *fields_end[ADSB_MAX_FIELDS_DECODE];
    unsigned int i = 0;

    const char *p = line, *s = p;
    while (*p && i < ADSB_MAX_FIELDS_DECODE) {
        if (*p == ',' || *p == '\n' || *p == '\r' || *p == '\0') {
            fields[i]     = s;
            fields_end[i] = p;
            i++;
            if (*p == '\0')
                break;
            s = p + 1;
        }
        p++;
    }
    if (i < ADSB_MAX_FIELDS_DECODE && s < p && p[-1] != ',') {
        fields[i]     = s;
        fields_end[i] = p;
        i++;
    }

    if (i < ADSB_MIN_FIELDS_REQUIRED)
        return false;
    if (fields_end[0] - fields[0] != 3 || strncmp(fields[0], "MSG", 3) != 0)
        return false;
    if (fields_end[1] - fields[1] != 1 || *fields[1] != '3')
        return false;
    if (fields[14] == fields_end[14] || fields[15] == fields_end[15])
        return false;

    const size_t icao_len = MAX((size_t)fields_end[4] - (size_t)fields[4], 6);
    memcpy(icao, fields[4], icao_len);
    icao[icao_len] = '\0';
    *lat           = strtod(fields[14], NULL);
    *lon           = strtod(fields[15], NULL);
    *alt           = (fields[11] < fields_end[11]) ? (int)strtol(fields[11], NULL, 10) : 0;

    return true;
}

int adsb_connect(void) {
    char adsb_host[MAX_NAME_LENGTH];
    if (!host_resolve(g_config.adsb_host, adsb_host, sizeof(adsb_host)))
        return -1;
    const int sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd < 0) {
        printf("adsb: connection failed to %s:%d (socket): %s\n", g_config.adsb_host, g_config.adsb_port, strerror(errno));
        return -1;
    }
    struct sockaddr_in servaddr = {
        .sin_family      = AF_INET,
        .sin_port        = htons(g_config.adsb_port),
        .sin_addr.s_addr = inet_addr(adsb_host),
    };
    if (connect(sockfd, (struct sockaddr *)&servaddr, sizeof(servaddr)) < 0) {
        printf("adsb: connection failed to %s:%d (connect): %s\n", g_config.adsb_host, g_config.adsb_port, strerror(errno));
        close(sockfd);
        return -1;
    }
    struct timeval tv;
    tv.tv_sec  = 30;
    tv.tv_usec = 0;
    if (setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) < 0)
        printf("adsb: warning: failed to set receive timeout: %s\n", strerror(errno));
    printf("adsb: connection succeeded to %s:%d\n", g_config.adsb_host, g_config.adsb_port);
    return sockfd;
}

void adsb_disconnect(const int sockfd) {
    if (sockfd >= 0)
        close(sockfd);
}

void *adsb_processing_thread(void *arg __attribute__((unused))) {
    int line_pos = 0;
    char line[MAX_LINE_LENGTH];
    int sockfd               = -1;
    int consecutive_errors   = 0;
    time_t last_message_time = time(NULL);

    printf("analyser: started\n");

    while (g_running) {

        if (interval_past(&last_message_time, MESSAGE_TIMEOUT) && sockfd >= 0) {
            printf("adsb: no messages received for %d minutes, reconnecting...\n", MESSAGE_TIMEOUT / 60);
            adsb_disconnect(sockfd);
            sockfd = -1;
        }

        if (sockfd < 0) {
            if ((sockfd = adsb_connect()) < 0) {
                printf("adsb: connection failed, retrying in %d seconds...\n", CONNECTION_RETRY_PERIOD);
                sleep(CONNECTION_RETRY_PERIOD);
                continue;
            }
            consecutive_errors = 0;
            line_pos           = 0;
        }

        char buffer[MAX_LINE_LENGTH];
        const ssize_t n = recv(sockfd, buffer, sizeof(buffer) - 1, 0);
        if (n == 0) {
            printf("adsb: connection closed by remote host\n");
            adsb_disconnect(sockfd);
            sockfd = -1;
            continue;
        } else if (n < 0) {
            if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)
                continue;
            printf("adsb: recv error: %s\n", strerror(errno));
            if (++consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
                printf("adsb: too many consecutive errors, reconnecting...\n");
                adsb_disconnect(sockfd);
                sockfd             = -1;
                consecutive_errors = 0;
            }
            continue;
        } else {
            last_message_time = time(NULL);
        }

        consecutive_errors = 0;

        buffer[n] = '\0';
        for (int i = 0; i < n; i++) {
            if (buffer[i] == '\n' || buffer[i] == '\r') {
                if (line_pos > 0) {
                    line[line_pos] = '\0';
                    line_pos       = 0;

                    if (g_config.debug && strncmp(line, "MSG,3", 5) == 0)
                        printf("debug: adsb MSG,3: %s\n", line);
                    if (strncmp(line, "MSG", 3) == 0) {
                        g_aircraft_stat.messages_total++;
                        g_aircraft_global.messages_total++;
                    }

                    char icao[7];
                    double lat, lon;
                    int altitude;
                    if (adsb_parse_sbs_position(line, icao, &lat, &lon, &altitude)) {
                        g_aircraft_stat.messages_position++;
                        g_aircraft_global.messages_position++;
                        aircraft_position_update(icao, lat, lon, altitude, time(NULL));
                    }
                }
            } else if (line_pos < MAX_LINE_LENGTH - 1)
                line[line_pos++] = buffer[i];
        }

        if (interval_past(&g_last_mqtt, g_config.interval_mqtt))
            aircraft_publish_mqtt();
    }

    adsb_disconnect(sockfd);

    printf("analyser: stopped\n");

    return NULL;
}

pthread_t adsb_processing_thread_handle;

bool adsb_processing_begin(void) {
    if (pthread_create(&adsb_processing_thread_handle, NULL, adsb_processing_thread, NULL) != 0) {
        perror("pthread_create");
        return false;
    }
    return true;
}

void adsb_processing_end(void) { pthread_join(adsb_processing_thread_handle, NULL); }

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

typedef bool (*persist_save_fn)(void);

typedef struct {
    persist_save_fn *save_fns;
    size_t num_fns;
    time_t interval;
    volatile bool *running;
} persist_thread_args_t;

pthread_t g_persist_thread;
persist_thread_args_t g_persist_args;

static void persist_save_all(const persist_thread_args_t *const args) {
    for (size_t i = 0; i < args->num_fns; i++)
        if (args->save_fns[i])
            args->save_fns[i]();
}

void *persist_thread_func(void *arg) {
    persist_thread_args_t *args = (persist_thread_args_t *)arg;
    time_t last_save            = time(NULL);

    if (g_config.debug)
        printf("persist: thread started (interval=%lds, functions=%zu)\n", args->interval, args->num_fns);

    while (interval_wait(&last_save, args->interval, args->running))
        persist_save_all(args);
    persist_save_all(args);

    if (g_config.debug)
        printf("persist: thread stopped\n");
    return NULL;
}

bool persist_begin(persist_save_fn *save_fns, const size_t num_fns, const time_t interval, volatile bool *running) {
    g_persist_args.save_fns = save_fns;
    g_persist_args.num_fns  = num_fns;
    g_persist_args.interval = interval;
    g_persist_args.running  = running;

    if (pthread_create(&g_persist_thread, NULL, persist_thread_func, &g_persist_args) != 0) {
        perror("pthread_create persist thread");
        return false;
    }
    return true;
}

void persist_end(void) { pthread_join(g_persist_thread, NULL); }

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

void print_config(void) {
    printf("config: adsb=%s:%d, mqtt=%s:%d, mqtt-topic=%s, mqtt-interval=%lds, status-interval=%lds, persist-interval=%lds, distance-max=%.0fnm, "
           "altitude-max=%dft, "
           "voxel-grid-x=%.0fnm, voxel-grid-y=%.0fft, position=%.6f,%0.6f, debug=%s\n",
           g_config.adsb_host, g_config.adsb_port, g_config.mqtt_host, g_config.mqtt_port, g_config.mqtt_topic, g_config.interval_mqtt,
           g_config.interval_status, g_config.interval_persist, g_config.distance_max_nm, g_config.altitude_max_ft, g_config.voxel_size_horizontal_nm,
           g_config.voxel_size_vertical_ft, g_config.position_lat, g_config.position_lon, g_config.debug ? "yes" : "no");
}

void print_status(void) {
    printf("status: messages=%lu [%lu], positions=%lu [%lu] (valid=%lu [%lu], invalid=%lu [%lu]), "
           "aircraft=%d [%lu], distance-max=%.1fnm (%s) [%.1fnm (%s)], altitude-max=%.0fft (%s) [%.0fft (%s)], "
           "published-mqtt=%lu [%lu]",
           g_aircraft_stat.messages_total, g_aircraft_global.messages_total, g_aircraft_stat.messages_position, g_aircraft_global.messages_position,
           g_aircraft_stat.position_valid, g_aircraft_global.position_valid, g_aircraft_stat.position_invalid, g_aircraft_global.position_invalid,
           g_aircraft_list.count, g_aircraft_global.aircraft_seen, g_aircraft_stat.distance_max.pos.distance_nm, g_aircraft_stat.distance_max.icao,
           g_aircraft_global.distance_max.pos.distance_nm, g_aircraft_global.distance_max.icao, (double)g_aircraft_stat.altitude_max.pos.altitude_ft,
           g_aircraft_stat.altitude_max.icao, (double)g_aircraft_global.altitude_max.pos.altitude_ft, g_aircraft_global.altitude_max.icao,
           g_aircraft_stat.published_mqtt, g_aircraft_global.published_mqtt);
    size_t voxel_occupied = 0, voxel_total = 0;
    double voxel_occupancy = 0.0;
    if (voxel_get_stats(&voxel_occupied, &voxel_total, &voxel_occupancy))
        printf(", voxels=%.0fK/%.0fK (%.1f%%)", (double)voxel_occupied / (double)(1024 * 1024), (double)voxel_total / (double)(1024 * 1024), voxel_occupancy);
    printf("\n");
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

void print_help(const char *const prog_name) {
    printf("usage: %s [options]\n", prog_name);
    printf("options:\n");
    printf("  --help                  Show this help message\n");
    printf("  --debug                 Enable debug output\n");
    printf("  --directory=PATH        Storage directory for voxel and data files (default: %s)\n", DEFAULT_DIRECTORY);
    printf("  --adsb=HOST[:PORT]      ADS-B server (default: %s:%d)\n", DEFAULT_ADSB_HOST, DEFAULT_ADSB_PORT);
    printf("  --mqtt=HOST[:PORT]      MQTT broker (default: %s:%d)\n", DEFAULT_MQTT_HOST, DEFAULT_MQTT_PORT);
    printf("  --mqtt-topic=TOPIC      MQTT topic (default: %s)\n", DEFAULT_MQTT_TOPIC);
    printf("  --mqtt-interval=SEC     MQTT update interval in seconds (default: %d)\n", DEFAULT_MQTT_INTERVAL);
    printf("  --status-interval=SEC   Status print interval in seconds (default: %d)\n", DEFAULT_STATUS_INTERVAL);
    printf("  --persist-interval=SEC  Persist save interval in seconds (default: %d)\n", DEFAULT_PERSIST_INTERVAL);
    printf("  --distance-max=NM       Maximum distance in nautical miles (default: %.0f)\n", DEFAULT_DISTANCE_MAX_NM);
    printf("  --altitude-max=FT       Maximum altitude in feet (default: %d)\n", DEFAULT_ALTITUDE_MAX_FT);
    printf("  --voxel-grid-x=NM       Voxel horizontal grid size in nautical miles (default: %.0f)\n", DEFAULT_VOXEL_SIZE_HORIZONTAL_NM);
    printf("  --voxel-grid-y=FT       Voxel vertical grid size in feet (default: %.0f)\n", DEFAULT_VOXEL_SIZE_VERTICAL_FT);
    printf("  --position=LAT,LON      Reference position (default: %.4f,%.4f)\n", DEFAULT_POSITION_LAT, DEFAULT_POSITION_LON);
    printf("examples:\n");
    printf("  %s --adsb=192.168.1.100:30003 --mqtt=broker.local\n", prog_name);
    printf("  %s --debug --mqtt-interval=60 --distance-max=500\n", prog_name);
}

const struct option long_options[] = { { "help", no_argument, 0, 'h' },
                                       { "debug", no_argument, 0, 'd' },
                                       { "directory", required_argument, 0, 'l' },
                                       { "adsb", required_argument, 0, 'a' },
                                       { "mqtt", required_argument, 0, 'm' },
                                       { "mqtt-topic", required_argument, 0, 't' },
                                       { "mqtt-interval", required_argument, 0, 'i' },
                                       { "status-interval", required_argument, 0, 's' },
                                       { "persist-interval", required_argument, 0, 'P' },
                                       { "distance-max", required_argument, 0, 'D' },
                                       { "altitude-max", required_argument, 0, 'A' },
                                       { "voxel-grid-x", required_argument, 0, 'X' },
                                       { "voxel-grid-y", required_argument, 0, 'Y' },
                                       { "position", required_argument, 0, 'p' },
                                       { 0, 0, 0, 0 } };

int parse_options(const int argc, char *const argv[]) {
    int option_index = 0, c;
    while ((c = getopt_long(argc, argv, "hd", long_options, &option_index)) != -1) {
        switch (c) {
        case 'h':
            print_help(argv[0]);
            return 1;
        case 'd':
            g_config.debug = true;
            break;
        case 'l':
            strncpy(g_config.directory, optarg, sizeof(g_config.directory) - 1);
            g_config.directory[sizeof(g_config.directory) - 1] = '\0';
            break;
        case 'a':
            if (!host_parse(optarg, g_config.adsb_host, sizeof(g_config.adsb_host), &g_config.adsb_port, DEFAULT_ADSB_PORT))
                return -1;
            break;
        case 'm':
            if (!host_parse(optarg, g_config.mqtt_host, sizeof(g_config.mqtt_host), &g_config.mqtt_port, DEFAULT_MQTT_PORT))
                return -1;
            break;
        case 't':
            strncpy(g_config.mqtt_topic, optarg, sizeof(g_config.mqtt_topic) - 1);
            g_config.mqtt_topic[sizeof(g_config.mqtt_topic) - 1] = '\0';
            break;
        case 'i':
            g_config.interval_mqtt = atoi(optarg);
            if (g_config.interval_mqtt <= 0) {
                fprintf(stderr, "invalid mqtt interval (seconds): %s\n", optarg);
                return -1;
            }
            break;
        case 's':
            g_config.interval_status = atoi(optarg);
            if (g_config.interval_status <= 0) {
                fprintf(stderr, "invalid status interval (seconds): %s\n", optarg);
                return -1;
            }
            break;
        case 'P':
            g_config.interval_persist = atoi(optarg);
            if (g_config.interval_persist <= 0) {
                fprintf(stderr, "invalid persist interval (seconds): %s\n", optarg);
                return -1;
            }
            break;
        case 'D':
            g_config.distance_max_nm = atof(optarg);
            if (g_config.distance_max_nm <= 0) {
                fprintf(stderr, "invalid max distance (nm): %s\n", optarg);
                return -1;
            }
            break;
        case 'A':
            g_config.altitude_max_ft = atoi(optarg);
            if (g_config.altitude_max_ft <= 0) {
                fprintf(stderr, "invalid max altitude (ft): %s\n", optarg);
                return -1;
            }
            break;
        case 'X':
            g_config.voxel_size_horizontal_nm = atof(optarg);
            if (g_config.voxel_size_horizontal_nm <= 0) {
                fprintf(stderr, "invalid voxel horizontal grid size (nm): %s\n", optarg);
                return -1;
            }
            break;
        case 'Y':
            g_config.voxel_size_vertical_ft = atof(optarg);
            if (g_config.voxel_size_vertical_ft <= 0) {
                fprintf(stderr, "invalid voxel vertical grid size (ft): %s\n", optarg);
                return -1;
            }
            break;
        case 'p': {
            char *const comma = strchr(optarg, ',');
            if (!comma) {
                fprintf(stderr, "invalid position format (lat, lon): %s\n", optarg);
                return -1;
            }
            *comma           = '\0';
            const double lat = atof(optarg), lon = atof(comma + 1);
            *comma = ',';
            if (!coordinates_are_valid(lat, lon)) {
                fprintf(stderr, "invalid position value (lat, lon): %s\n", optarg);
                return -1;
            }
            g_config.position_lat = lat;
            g_config.position_lon = lon;
            break;
        }
        default:
        case '?':
            return -1;
        }
    }
    return 0;
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

void signal_handler(const int sig) {
    if (sig == SIGINT || sig == SIGTERM) {
        printf("\nsignal received (%s): shutting down\n", sig == SIGINT ? "SIGINT" : "SIGTERM");
        g_running = false;
    }
}

int main(const int argc, char *const argv[]) {
    const int r = parse_options(argc, argv);
    if (r != 0)
        return r;
    print_config();

    if (!voxel_map_begin())
        return EXIT_FAILURE;
    if (!aircraft_begin())
        return EXIT_FAILURE;
    if (!mqtt_begin(g_config.mqtt_host, g_config.mqtt_port))
        return EXIT_FAILURE;

    static persist_save_fn save_functions[] = { voxel_map_save, aircraft_stats_save };
    if (!persist_begin(save_functions, sizeof(save_functions) / sizeof(save_functions[0]), g_config.interval_persist, &g_running))
        return EXIT_FAILURE;

    if (!adsb_processing_begin())
        return EXIT_FAILURE;

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);
    signal(SIGPIPE, SIG_IGN);
    while (interval_wait(&g_last_status, g_config.interval_status, &g_running))
        print_status();
    print_status();

    adsb_processing_end();
    persist_end();
    mqtt_end();
    aircraft_end();
    voxel_map_end();

    return EXIT_SUCCESS;
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------
