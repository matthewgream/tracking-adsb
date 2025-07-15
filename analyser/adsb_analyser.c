
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

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

#define DEFAULT_DIRECTORY "/opt/tracking-adsb/analyser"
#define DEFAULT_ADSB_HOST "127.0.0.1"
#define DEFAULT_ADSB_PORT 30003
#define DEFAULT_MQTT_HOST "127.0.0.1"
#define DEFAULT_MQTT_PORT 1883
#define DEFAULT_MQTT_TOPIC "adsb/analyser"
#define DEFAULT_MQTT_CLIENT_ID "adsb_analyser"
#define DEFAULT_MQTT_INTERVAL 300
#define DEFAULT_STATUS_INTERVAL 300
#define DEFAULT_POSITION_LAT 51.501126
#define DEFAULT_POSITION_LON -0.14239
#define DEFAULT_DISTANCE_MAX_NM 1000.0
#define DEFAULT_ALTITUDE_MAX_FT 75000.0
#define DEFAULT_ALTITUDE_MIN_FT -1500.0

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

#define MAX_NAME_LENGTH 256
#define MAX_LINE_LENGTH 512
#define MAX_AIRCRAFT 65536
#define HASH_MASK (MAX_AIRCRAFT - 1)
#define PRUNE_THRESHOLD 0.95
#define PRUNE_RATIO 0.05
#define LOOP_SLEEP 5

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
    double distance_max_nm;
    double altitude_max_ft;
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
    aircraft_stat_posn_t distance_max;
    aircraft_stat_posn_t altitude_max;
} aircraft_stat_t;

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

config_t g_config = { // defaults
    .directory       = DEFAULT_DIRECTORY,
    .adsb_host       = DEFAULT_ADSB_HOST,
    .adsb_port       = DEFAULT_ADSB_PORT,
    .mqtt_host       = DEFAULT_MQTT_HOST,
    .mqtt_port       = DEFAULT_MQTT_PORT,
    .mqtt_topic      = DEFAULT_MQTT_TOPIC,
    .interval_mqtt   = DEFAULT_MQTT_INTERVAL,
    .interval_status = DEFAULT_STATUS_INTERVAL,
    .distance_max_nm = DEFAULT_DISTANCE_MAX_NM,
    .altitude_max_ft = DEFAULT_ALTITUDE_MAX_FT,
    .position_lat    = DEFAULT_POSITION_LAT,
    .position_lon    = DEFAULT_POSITION_LON,
    .debug           = false
};
aircraft_list_t g_aircraft_list = { 0 };
aircraft_stat_t g_aircraft_stat = { 0 };
volatile bool g_running;
time_t g_last_mqtt       = 0;
time_t g_last_status     = 0;
struct mosquitto *g_mosq = NULL;

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

static bool interval_passed(time_t *const last, const time_t interval) {
    const time_t now = time(NULL);
    if (*last == 0)
        *last = now;
    else if ((now - *last) >= interval) {
        *last = now;
        return true;
    }
    return false;
}

static bool interval_wait(time_t *const last, const time_t interval) {
    const time_t now = time(NULL);
    if (*last == 0)
        *last = now;
    if ((now - *last) < interval)
        sleep((unsigned int)(interval - (now - *last)));
    *last = time(NULL);
    return true;
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

#define VOXEL_SIZE_HORIZONTAL_NM 1.0
#define VOXEL_SIZE_VERTICAL_FT 1000.0
#define VOXEL_MAX_COUNT ((1 << 16) - 1)
#define VOXEL_FILE_PATH "adsb_voxel_map.dat"
#define VOXEL_SAVE_INTERVAL (30 * 60)
#define VOXEL_FILE_MAGIC 0x56585041 // "VXPA" in hex
#define VOXEL_FILE_VERSION 1

typedef unsigned short voxel_data_t;

typedef struct {
    voxel_data_t *data;
    int size_x, size_y, size_z;
    int bits;
    size_t total_voxels;
    double origin_lat, origin_lon;
    double max_radius_nm, max_altitude_ft;
    time_t last_save;
} voxel_map_t;

voxel_map_t g_voxel_map = { 0 };
pthread_t g_voxel_thread;

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
    const double distance_nm = calculate_distance_nm(g_config.position_lat, g_config.position_lon, lat, lon);
    const double lat1_rad = g_config.position_lat * M_PI / 180.0, lat2_rad = lat * M_PI / 180.0, dlon_rad = (lon - g_config.position_lon) * M_PI / 180.0;
    const double bearing = atan2(sin(dlon_rad) * cos(lat2_rad), cos(lat1_rad) * sin(lat2_rad) - sin(lat1_rad) * cos(lat2_rad) * cos(dlon_rad));
    const double dx_nm = distance_nm * sin(bearing), dy_nm = distance_nm * cos(bearing);
    *x = constrain_int((int)((dx_nm / VOXEL_SIZE_HORIZONTAL_NM) + (g_voxel_map.size_x / 2)), 0, g_voxel_map.size_x - 1);
    *y = constrain_int((int)((dy_nm / VOXEL_SIZE_HORIZONTAL_NM) + (g_voxel_map.size_y / 2)), 0, g_voxel_map.size_y - 1);
    *z = constrain_int((int)((altitude_ft / VOXEL_SIZE_VERTICAL_FT)), 0, g_voxel_map.size_z - 1);
}

size_t voxel_indices_to_index(const int x, const int y, const int z) {
    return (size_t)z * (size_t)g_voxel_map.size_x * (size_t)g_voxel_map.size_y + (size_t)y * (size_t)g_voxel_map.size_x + (size_t)x;
}

void voxel_map_update(const double lat, const double lon, const double altitude_ft) {
    if (!g_voxel_map.data)
        return;
    int x, y, z;
    voxel_coords_to_indices(lat, lon, altitude_ft, &x, &y, &z);
    const size_t idx = voxel_indices_to_index(x, y, z);
    if (g_voxel_map.data[idx] < VOXEL_MAX_COUNT)
        if (g_voxel_map.data[idx]++ == 0 && g_config.debug)
            printf("debug: voxel: created [%d,%d,%d] (%.1fnm, %.1fnm, %.0fft)\n", x, y, z, (x - g_voxel_map.size_x / 2) * VOXEL_SIZE_HORIZONTAL_NM,
                   (y - g_voxel_map.size_y / 2) * VOXEL_SIZE_HORIZONTAL_NM, z * VOXEL_SIZE_VERTICAL_FT);
}

bool voxel_map_save(void) {
    if (!g_voxel_map.data)
        return false;

    char path[MAX_LINE_LENGTH];
    snprintf(path, sizeof(path), "%s/%s", g_config.directory, VOXEL_FILE_PATH);
    FILE *fp = fopen(path, "wb");
    if (!fp) {
        printf("voxel: map open file for write failed: %s\n", path);
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
    fwrite(&g_voxel_map.max_radius_nm, sizeof(g_voxel_map.max_radius_nm), 1, fp);
    fwrite(&g_voxel_map.max_altitude_ft, sizeof(g_voxel_map.max_altitude_ft), 1, fp);
    const size_t wrote = fwrite(g_voxel_map.data, sizeof(voxel_data_t), g_voxel_map.total_voxels, fp);

    fclose(fp);
    if (wrote != g_voxel_map.total_voxels) {
        printf("voxel: map write file failed (wrote %zu of %zu voxels): %s\n", wrote, g_voxel_map.total_voxels, path);
        return false;
    }

    if (g_config.debug)
        printf("voxel: map save file to %s (%.1f%% occupied)\n", path, voxel_get_occupancy());
    return true;
}

bool voxel_map_load(void) {
    if (!g_voxel_map.data)
        return false;

    char path[MAX_LINE_LENGTH];
    snprintf(path, sizeof(path), "%s/%s", g_config.directory, VOXEL_FILE_PATH);
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        if (errno != ENOENT)
            printf("voxel: map open file for read failed: %s\n", path);
        return false;
    }

    unsigned int magic, version;
    int size_x, size_y, size_z;
    double origin_lat, origin_lon, max_radius_nm, max_altitude_ft;
    if (fread(&magic, sizeof(magic), 1, fp) != 1 || magic != VOXEL_FILE_MAGIC) {
        printf("voxel: map read file has invalid magic\n");
        fclose(fp);
        return false;
    }
    fread(&version, sizeof(version), 1, fp);
    if (version != VOXEL_FILE_VERSION) {
        printf("voxel: map read file has unspported version %u\n", version);
        fclose(fp);
        return false;
    }
    fread(&size_x, sizeof(size_x), 1, fp);
    fread(&size_y, sizeof(size_y), 1, fp);
    fread(&size_z, sizeof(size_z), 1, fp);
    fread(&origin_lat, sizeof(origin_lat), 1, fp);
    fread(&origin_lon, sizeof(origin_lon), 1, fp);
    fread(&max_radius_nm, sizeof(max_radius_nm), 1, fp);
    fread(&max_altitude_ft, sizeof(max_altitude_ft), 1, fp);
    if (size_x != g_voxel_map.size_x || size_y != g_voxel_map.size_y || size_z != g_voxel_map.size_z || fabs(origin_lat - g_voxel_map.origin_lat) > 0.0001 ||
        fabs(origin_lon - g_voxel_map.origin_lon) > 0.0001) {
        printf("voxel: map read file has mismatched dimensions or origin\n");
        fclose(fp);
        return false;
    }
    const size_t read = fread(g_voxel_map.data, sizeof(voxel_data_t), g_voxel_map.total_voxels, fp);

    fclose(fp);

    if (read != g_voxel_map.total_voxels) {
        printf("voxel: map read file failed (read %zu of %zu voxels): %s\n", read, g_voxel_map.total_voxels, path);
        return false;
    }

    printf("voxel: map load file from %s (%.1f%% occupied)\n", path, voxel_get_occupancy());
    return true;
}

void *voxel_save_thread(void *arg __attribute__((unused))) {
    if (g_config.debug)
        printf("voxel: map save file thread started\n");
    while (g_running)
        if (interval_wait(&g_voxel_map.last_save, VOXEL_SAVE_INTERVAL))
            voxel_map_save();
    voxel_map_save();
    if (g_config.debug)
        printf("voxel: map save file thread stopped\n");
    return NULL;
}

bool voxel_map_begin(void) {
    g_voxel_map.max_radius_nm   = g_config.distance_max_nm;
    g_voxel_map.max_altitude_ft = g_config.altitude_max_ft;
    g_voxel_map.size_x          = (int)((g_voxel_map.max_radius_nm * 2.0) / VOXEL_SIZE_HORIZONTAL_NM) + 1;
    g_voxel_map.size_y          = (int)((g_voxel_map.max_radius_nm * 2.0) / VOXEL_SIZE_HORIZONTAL_NM) + 1;
    g_voxel_map.size_z          = (int)(g_config.altitude_max_ft / VOXEL_SIZE_VERTICAL_FT) + 1;
    g_voxel_map.bits            = sizeof(voxel_data_t) * 8;
    g_voxel_map.total_voxels    = (size_t)g_voxel_map.size_x * (size_t)g_voxel_map.size_y * (size_t)g_voxel_map.size_z;
    g_voxel_map.data            = (voxel_data_t *)calloc(g_voxel_map.total_voxels, sizeof(voxel_data_t));
    if (!g_voxel_map.data) {
        printf("voxel: failed to allocate memory for %zu voxels (%.1f MB)\n", g_voxel_map.total_voxels, voxel_get_memorysize());
        return false;
    }
    g_voxel_map.origin_lat = g_config.position_lat;
    g_voxel_map.origin_lon = g_config.position_lon;
    g_voxel_map.last_save  = time(NULL);
    printf("voxel: initialised using %.0fnm/%.0fft boxes to %.0fnm radius and %.0fft altitude at %d bits = %.0fK voxels (%.1f MB)\n", VOXEL_SIZE_HORIZONTAL_NM,
           VOXEL_SIZE_VERTICAL_FT, g_voxel_map.max_radius_nm, g_voxel_map.max_altitude_ft, g_voxel_map.bits,
           (double)g_voxel_map.total_voxels / (double)(1024 * 1024), voxel_get_memorysize());
    voxel_map_load();
    if (pthread_create(&g_voxel_thread, NULL, voxel_save_thread, NULL) != 0) {
        perror("pthread_create voxel thread");
        return false;
    }
    return true;
}

void voxel_map_end(void) {
    pthread_join(g_voxel_thread, NULL);
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

bool position_is_valid(const double lat, const double lon, const int altitude_ft, const double distance_nm) {
    return (lat >= -90.0 && lat <= 90.0 && lon >= -180.0 && lon <= 180.0) &&
           (altitude_ft >= DEFAULT_ALTITUDE_MIN_FT && altitude_ft <= g_config.altitude_max_ft) && (distance_nm <= g_config.distance_max_nm);
}

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

    return &g_aircraft_list.entries[index];
}

void aircraft_position_update(const char *const icao, const double lat, const double lon, const int altitude_ft, const time_t timestamp) {

    const double distance_nm = calculate_distance_nm(g_config.position_lat, g_config.position_lon, lat, lon);

    if (!position_is_valid(lat, lon, altitude_ft, distance_nm)) {
        g_aircraft_stat.position_invalid++;
        if (g_config.debug)
            printf("debug: aircraft position: invalid (icao=%s, lat=%.6f, lon=%.6f, alt=%d, dist=%.1f)\n", icao, lat, lon, altitude_ft, distance_nm);
        return;
    }

    g_aircraft_stat.position_valid++;

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

    if ((double)altitude_ft > g_aircraft_stat.altitude_max.pos.altitude_ft)
        position_stat_record_set(&g_aircraft_stat.altitude_max, lat, lon, altitude_ft, distance_nm, timestamp, icao);
}

void aircraft_publish_mqtt(void) {
    const time_t now = time(NULL);
    char line_str[MAX_LINE_LENGTH * 2];
    char json_str[65536];
    size_t json_off                           = 0;
    unsigned long published_cnt               = 0;
    unsigned char published_set[MAX_AIRCRAFT] = { 0 };

    pthread_mutex_lock(&g_aircraft_list.mutex);
    json_off +=
        (size_t)snprintf(json_str + json_off, sizeof(json_str) - json_off, "{\"timestamp\":%ld,\"position_lat\":%.6f,\"position_lon\":%.6f,\"aircraft\":[", now,
                         g_config.position_lat, g_config.position_lon);
    for (int i = 0; i < MAX_AIRCRAFT; i++)
        if (g_aircraft_list.entries[i].icao[0] != '\0')
            if (g_aircraft_list.entries[i].published < g_aircraft_list.entries[i].pos.timestamp && g_aircraft_list.entries[i].bounds_initialised) {
                aircraft_data_t *ac   = &g_aircraft_list.entries[i];
                const size_t line_len = (size_t)snprintf(
                    line_str, sizeof(line_str),
                    "%s{\"icao\":\"%s\",\"current\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"first\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"bounds\":{"
                    "\"min_lat\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"max_lat\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"min_lon\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"max_lon\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"min_alt\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"max_alt\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"min_dist\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld},"
                    "\"max_dist\":{\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld}"
                    "}}",
                    (published_cnt > 0 ? "," : ""), ac->icao, ac->pos.lat, ac->pos.lon, ac->pos.altitude_ft, ac->pos.distance_nm, ac->pos.timestamp,
                    ac->pos_first.lat, ac->pos_first.lon, ac->pos_first.altitude_ft, ac->pos_first.distance_nm, ac->pos_first.timestamp, ac->min_lat_pos.lat,
                    ac->min_lat_pos.lon, ac->min_lat_pos.altitude_ft, ac->min_lat_pos.distance_nm, ac->min_lat_pos.timestamp, ac->max_lat_pos.lat,
                    ac->max_lat_pos.lon, ac->max_lat_pos.altitude_ft, ac->max_lat_pos.distance_nm, ac->max_lat_pos.timestamp, ac->min_lon_pos.lat,
                    ac->min_lon_pos.lon, ac->min_lon_pos.altitude_ft, ac->min_lon_pos.distance_nm, ac->min_lon_pos.timestamp, ac->max_lon_pos.lat,
                    ac->max_lon_pos.lon, ac->max_lon_pos.altitude_ft, ac->max_lon_pos.distance_nm, ac->max_lon_pos.timestamp, ac->min_alt_pos.lat,
                    ac->min_alt_pos.lon, ac->min_alt_pos.altitude_ft, ac->min_alt_pos.distance_nm, ac->min_alt_pos.timestamp, ac->max_alt_pos.lat,
                    ac->max_alt_pos.lon, ac->max_alt_pos.altitude_ft, ac->max_alt_pos.distance_nm, ac->max_alt_pos.timestamp, ac->min_dist_pos.lat,
                    ac->min_dist_pos.lon, ac->min_dist_pos.altitude_ft, ac->min_dist_pos.distance_nm, ac->min_dist_pos.timestamp, ac->max_dist_pos.lat,
                    ac->max_dist_pos.lon, ac->max_dist_pos.altitude_ft, ac->max_dist_pos.distance_nm, ac->max_dist_pos.timestamp);
                if (json_off + line_len >= ((int)sizeof(json_str) - 3))
                    break;
                json_off += (size_t)snprintf(json_str + json_off, sizeof(json_str) - json_off, "%s", line_str);
                published_cnt++;
                published_set[i]++;
            }
    json_off += (size_t)snprintf(json_str + json_off, sizeof(json_str) - json_off, "]}");
    pthread_mutex_unlock(&g_aircraft_list.mutex);

    if (published_cnt > 0) {
        const int rc = mosquitto_publish(g_mosq, NULL, g_config.mqtt_topic, (int)json_off, json_str, 0, false);
        if (rc == MOSQ_ERR_SUCCESS) {
            g_aircraft_stat.published_mqtt += published_cnt;
            for (int i = 0; i < MAX_AIRCRAFT; i++) // locking not needed
                if (published_set[i])
                    g_aircraft_list.entries[i].published = now;
        } else
            printf("mqtt: %lu aircraft updates, publish failed: %s\n", published_cnt, mosquitto_strerror(rc));
    }
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

bool adsb_parse_sbs_position(const char *const line, char *const icao, double *const lat, double *const lon, int *const altitude) {
    char buf[MAX_LINE_LENGTH];
    strncpy(buf, line, MAX_LINE_LENGTH - 1);
    buf[MAX_LINE_LENGTH - 1] = '\0';
#define ADSB_MAX_FIELDS_DECODE 18
#define ADSB_MIN_FIELDS_REQUIRED 16

    char *fields[ADSB_MAX_FIELDS_DECODE];
    int i       = 0;
    char *p     = buf;
    char *start = p;
    while (*p && i < ADSB_MAX_FIELDS_DECODE) { // can be up to 24
        if (*p == ',') {
            *p          = '\0';
            fields[i++] = start;
            start       = p + 1;
        }
        p++;
    }
    if (i < ADSB_MAX_FIELDS_DECODE && start < p)
        fields[i++] = start;
    if (i < ADSB_MIN_FIELDS_REQUIRED)
        return false;

    if (strcmp(fields[0], "MSG") != 0 || strcmp(fields[1], "3") != 0)
        return false;

    if (strlen(fields[14]) == 0 || strlen(fields[15]) == 0)
        return false;

    strncpy(icao, fields[4], 6);
    icao[6]   = '\0';
    *lat      = atof(fields[14]);
    *lon      = atof(fields[15]);
    *altitude = (fields[11] && strlen(fields[11]) > 0) ? atoi(fields[11]) : 0;

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

    const int sockfd = adsb_connect();
    if (sockfd < 0)
        return NULL;

    printf("analyser: started\n");

    while (g_running) {

        char buffer[MAX_LINE_LENGTH];
        const ssize_t n = recv(sockfd, buffer, sizeof(buffer) - 1, 0);
        if (n <= 0) {
            if (n < 0)
                perror("recv");
            break;
        }

        buffer[n] = '\0';
        for (int i = 0; i < n; i++) {
            if (buffer[i] == '\n' || buffer[i] == '\r') {
                if (line_pos > 0) {
                    line[line_pos] = '\0';

                    if (g_config.debug && strncmp(line, "MSG,3", 5) == 0)
                        printf("debug: adsb MSG,3: %s\n", line);
                    if (strncmp(line, "MSG", 3) == 0)
                        g_aircraft_stat.messages_total++;

                    char icao[7];
                    double lat, lon;
                    int altitude;
                    if (adsb_parse_sbs_position(line, icao, &lat, &lon, &altitude)) {
                        g_aircraft_stat.messages_position++;
                        aircraft_position_update(icao, lat, lon, altitude, time(NULL));
                    }
                    line_pos = 0;
                }
            } else if (line_pos < MAX_LINE_LENGTH - 1)
                line[line_pos++] = buffer[i];
        }

        if (interval_passed(&g_last_mqtt, g_config.interval_mqtt))
            aircraft_publish_mqtt();
    }

    adsb_disconnect(sockfd);

    printf("analyser: stopped\n");

    return NULL;
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

void mqtt_on_connect(struct mosquitto *mosq __attribute__((unused)), void *obj __attribute__((unused)), int rc) {
    if (rc == 0)
        printf("mqtt: connection succeeded to %s:%d\n", g_config.mqtt_host, g_config.mqtt_port);
    else
        printf("mqtt: connection failed to %s:%d (mosquitto_connect): %s\n", g_config.mqtt_host, g_config.mqtt_port, mosquitto_strerror(rc));
}

bool mqtt_begin(void) {
    char mqtt_host[MAX_NAME_LENGTH];
    if (!host_resolve(g_config.mqtt_host, mqtt_host, sizeof(mqtt_host)))
        return false;
    mosquitto_lib_init();
    g_mosq = mosquitto_new(DEFAULT_MQTT_CLIENT_ID, true, NULL);
    if (!g_mosq) {
        mosquitto_lib_cleanup();
        printf("mqtt: connection failed to %s:%d (mosquitto_new)\n", g_config.mqtt_host, g_config.mqtt_port);
        return false;
    }
    mosquitto_connect_callback_set(g_mosq, mqtt_on_connect);
    const int rc = mosquitto_connect(g_mosq, mqtt_host, g_config.mqtt_port, 60);
    if (rc != MOSQ_ERR_SUCCESS) {
        printf("mqtt: connection failed to %s:%d (mosquitto_connect): %s\n", g_config.mqtt_host, g_config.mqtt_port, mosquitto_strerror(rc));
        return false;
    }
    mosquitto_loop_start(g_mosq);
    return true;
}

void mqtt_end(void) {
    if (g_mosq) {
        mosquitto_loop_stop(g_mosq, true);
        mosquitto_destroy(g_mosq);
        mosquitto_lib_cleanup();
    }
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------

void print_config(void) {
    printf("config: adsb=%s:%d, mqtt=%s:%d, mqtt-topic=%s, mqtt-interval=%lus, status-interval=%lus, distance-max=%.0fnm, altitude=max=%.0fft, "
           "position=%.6f,%0.6f, debug=%s\n",
           g_config.adsb_host, g_config.adsb_port, g_config.mqtt_host, g_config.mqtt_port, g_config.mqtt_topic, g_config.interval_mqtt,
           g_config.interval_status, g_config.distance_max_nm, g_config.altitude_max_ft, g_config.position_lat, g_config.position_lon,
           g_config.debug ? "yes" : "no");
}

void print_status(void) {
    printf("status: messages=%lu, positions=%lu (valid=%lu, invalid=%lu), aircraft=%d, distance-max=%.1fnm (%s), altitude-max=%.0fft (%s), published-mqtt=%lu",
           g_aircraft_stat.messages_total, g_aircraft_stat.messages_position, g_aircraft_stat.position_valid, g_aircraft_stat.position_invalid,
           g_aircraft_list.count, g_aircraft_stat.distance_max.pos.distance_nm, g_aircraft_stat.distance_max.icao,
           (double)g_aircraft_stat.altitude_max.pos.altitude_ft, g_aircraft_stat.altitude_max.icao, g_aircraft_stat.published_mqtt);
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
    printf("  --help                Show this help message\n");
    printf("  --debug               Enable debug output\n");
    printf("  --directory=PATH      storage directory for voxel and data files (default: %s)\n", DEFAULT_DIRECTORY);
    printf("  --adsb=HOST[:PORT]    ADS-B server (default: %s:%d)\n", DEFAULT_ADSB_HOST, DEFAULT_ADSB_PORT);
    printf("  --mqtt=HOST[:PORT]    MQTT broker (default: %s:%d)\n", DEFAULT_MQTT_HOST, DEFAULT_MQTT_PORT);
    printf("  --mqtt-topic=TOPIC    MQTT topic (default: %s)\n", DEFAULT_MQTT_TOPIC);
    printf("  --mqtt-interval=SEC   MQTT update interval in seconds (default: %d)\n", DEFAULT_MQTT_INTERVAL);
    printf("  --status-interval=SEC Status print interval in seconds (default: %d)\n", DEFAULT_STATUS_INTERVAL);
    printf("  --distance-max=NM     Maximum distance in nautical miles (default: %.0f)\n", DEFAULT_DISTANCE_MAX_NM);
    printf("  --altitude-max=FT     Maximum altitude in feet (default: %.0f)\n", DEFAULT_ALTITUDE_MAX_FT);
    printf("  --position=LAT,LON    Reference position (default: %.4f,%.4f)\n", DEFAULT_POSITION_LAT, DEFAULT_POSITION_LON);
    printf("examples:\n");
    printf("  %s --adsb=192.168.1.100:30003 --mqtt=broker.local\n", prog_name);
    printf("  %s --debug --mqtt-interval=60 --distance-max=500\n", prog_name);
}

const struct option long_options[] = { // defaults
    { "help", no_argument, 0, 'h' },
    { "debug", no_argument, 0, 'd' },
    { "directory", required_argument, 0, 'l' },
    { "adsb", required_argument, 0, 'a' },
    { "mqtt", required_argument, 0, 'm' },
    { "mqtt-topic", required_argument, 0, 't' },
    { "mqtt-interval", required_argument, 0, 'i' },
    { "status-interval", required_argument, 0, 's' },
    { "distance-max", required_argument, 0, 'D' },
    { "altitude-max", required_argument, 0, 'A' },
    { "position", required_argument, 0, 'p' },
    { 0, 0, 0, 0 }
};

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
                fprintf(stderr, "invalid mqtt interval: %s\n", optarg);
                return -1;
            }
            break;
        case 's':
            g_config.interval_status = atoi(optarg);
            if (g_config.interval_status <= 0) {
                fprintf(stderr, "invalid status interval: %s\n", optarg);
                return -1;
            }
            break;
        case 'D':
            g_config.distance_max_nm = atof(optarg);
            if (g_config.distance_max_nm <= 0) {
                fprintf(stderr, "invalid max distance: %s\n", optarg);
                return -1;
            }
            break;
        case 'A':
            g_config.altitude_max_ft = atof(optarg);
            if (g_config.altitude_max_ft <= 0) {
                fprintf(stderr, "invalid max altitude: %s\n", optarg);
                return -1;
            }
            break;
        case 'p': {
            char *const comma = strchr(optarg, ',');
            if (!comma) {
                fprintf(stderr, "invalid position format: %s\n", optarg);
                return -1;
            }
            *comma           = '\0';
            const double lat = atof(optarg), lon = atof(comma + 1);
            *comma = ','; // Restore for error message if needed
            if (!coordinates_are_valid(lat, lon)) {
                fprintf(stderr, "invalid position: %s\n", optarg);
                return -1;
            }
            g_config.position_lat = lat;
            g_config.position_lon = lon;
            break;
        }
        default:
        case '?':
            // getopt_long already printed an error message
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

    if (!mqtt_begin())
        return 1;
    if (!voxel_map_begin())
        return 1;

    pthread_mutex_init(&g_aircraft_list.mutex, NULL);
    pthread_t processing_thread;
    if (pthread_create(&processing_thread, NULL, adsb_processing_thread, NULL) != 0) {
        perror("pthread_create");
        return 1;
    }

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);
    signal(SIGPIPE, SIG_IGN); // Ignore broken pipe
    g_running = true;
    while (g_running)
        if (interval_wait(&g_last_status, g_config.interval_status))
            print_status();
    print_status();

    pthread_join(processing_thread, NULL);
    mqtt_end();
    pthread_mutex_destroy(&g_aircraft_list.mutex);
    voxel_map_end();

    return 0;
}

// -----------------------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------------------------
