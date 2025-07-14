
// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

#define DEFAULT_ADSB_HOST "127.0.0.1"
#define DEFAULT_ADSB_PORT 30003
#define DEFAULT_MQTT_HOST "127.0.0.1"
#define DEFAULT_MQTT_PORT 1883
#define DEFAULT_MQTT_TOPIC "adsb/analyser"
#define DEFAULT_MQTT_CLIENT_ID "adsb_analyser"
#define DEFAULT_MQTT_INTERVAL 300
#define DEFAULT_STATUS_INTERVAL 60
#define DEFAULT_POSITION_LAT 51.501126
#define DEFAULT_POSITION_LON -0.14239
#define DEFAULT_DISTANCE_MAX_NM 1000.0
#define DEFAULT_ALTITUDE_MAX_FT 75000.0
#define DEFAULT_ALTITUDE_MIN_FT -1500.0

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

#define MAX_NAME_LENGTH 256
#define MAX_LINE_LENGTH 512
#define MAX_AIRCRAFT 65536
#define HASH_MASK (MAX_AIRCRAFT - 1)
#define PRUNE_THRESHOLD 0.95
#define PRUNE_RATIO 0.05

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

typedef struct {
    char adsb_host[MAX_NAME_LENGTH];
    unsigned short adsb_port;
    char mqtt_host[MAX_NAME_LENGTH];
    unsigned short mqtt_port;
    char mqtt_topic[MAX_NAME_LENGTH];
    int mqtt_interval;
    int status_interval;
    double distance_max_nm;
    double altitude_max_ft;
    double position_lat, position_lon;
    bool debug;
} config_t;

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

typedef struct {
    char icao[7];
    double lat;
    double lon;
    int altitude_ft;
    double distance;
    time_t timestamp;
    time_t last_seen;
    time_t published;
} aircraft_t;

typedef struct {
    aircraft_t entries[MAX_AIRCRAFT];
    int count;
    pthread_mutex_t mutex;
} aircraft_map_t;

typedef struct {
    unsigned long messages_total;
    unsigned long messages_position;
    unsigned long position_valid;
    unsigned long position_invalid;
    unsigned long published_mqtt;
    double distance_max;
    char distance_max_icao[7];
    double altitude_max;
    char altitude_max_icao[7];
} stats_t;

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

config_t g_config = { // defaults
    .adsb_host       = DEFAULT_ADSB_HOST,
    .adsb_port       = DEFAULT_ADSB_PORT,
    .mqtt_host       = DEFAULT_MQTT_HOST,
    .mqtt_port       = DEFAULT_MQTT_PORT,
    .mqtt_topic      = DEFAULT_MQTT_TOPIC,
    .mqtt_interval   = DEFAULT_MQTT_INTERVAL,
    .status_interval = DEFAULT_STATUS_INTERVAL,
    .distance_max_nm = DEFAULT_DISTANCE_MAX_NM,
    .altitude_max_ft = DEFAULT_ALTITUDE_MAX_FT,
    .position_lat    = DEFAULT_POSITION_LAT,
    .position_lon    = DEFAULT_POSITION_LON,
    .debug           = false
};
aircraft_map_t g_aircraft_map = { 0 };
stats_t g_stats               = { 0 };
volatile bool g_running       = true;
time_t g_last_mqtt;
time_t g_last_status;
struct mosquitto *g_mosq = NULL;

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

bool host_resolve(const char *const hostname, char *const ip_str, const size_t ip_str_size) {
    struct in_addr addr;
    if (inet_aton(hostname, &addr)) {
        snprintf(ip_str, ip_str_size, "%s", hostname);
        ip_str[ip_str_size - 1] = '\0';
        return true;
    }
    const struct hostent *he = gethostbyname(hostname);
    if (!he) {
        fprintf(stderr, "failed to resolve hostname: %s\n", hostname);
        return false;
    }
    addr.s_addr = *((in_addr_t *)he->h_addr_list[0]);
    snprintf(ip_str, ip_str_size, "%s", inet_ntoa(addr));
    return true;
}

bool host_parse(const char *const input, char *const host, const size_t host_size, unsigned short *const port, const unsigned short default_port) {
    const char *const colon = strrchr(input, ':');
    if (!colon) {
        strncpy(host, input, host_size - 1);
        host[host_size - 1] = '\0';
        *port               = default_port;
    } else {
        const size_t host_len = (size_t)(colon - input);
        if (host_len >= host_size) {
            fprintf(stderr, "host name too long\n");
            return false;
        }
        strncpy(host, input, host_len);
        host[host_len] = '\0';
        *port          = (unsigned short)atoi(colon + 1);
        if (*port <= 0) {
            fprintf(stderr, "invalid port number: %s\n", colon + 1);
            return false;
        }
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

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

bool coordinates_are_valid(const double lat, const double lon) { return (lat >= -90.0 && lat <= 90.0 && lon >= -180.0 && lon <= 180.0); }

bool validate_position(const double lat, const double lon, const int altitude_ft, const double distance_nm) {
    return (lat >= -90.0 && lat <= 90.0 && lon >= -180.0 && lon <= 180.0) &&
           (altitude_ft >= DEFAULT_ALTITUDE_MIN_FT && altitude_ft <= g_config.altitude_max_ft) && (distance_nm <= g_config.distance_max_nm);
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

aircraft_t *aircraft_find_or_create(const char *const icao) {
    unsigned int index = hash_icao(icao), index_original = index;

    while (g_aircraft_map.entries[index].icao[0] != '\0') {
        if (strcmp(g_aircraft_map.entries[index].icao, icao) == 0)
            return &g_aircraft_map.entries[index]; // Found existing
        index = (index + 1) & HASH_MASK;
        if (index == index_original)
            return NULL;
    }

    if (g_aircraft_map.count >= (int)(MAX_AIRCRAFT * PRUNE_THRESHOLD)) {
        int to_remove      = (int)(MAX_AIRCRAFT * PRUNE_RATIO);
        time_t oldest_time = time(NULL);
        if (g_config.debug)
            printf("debug: aircraft map: pruning %d oldest entries\n", to_remove);
        while (to_remove > 0) {
            int oldest_idx = -1;
            oldest_time    = time(NULL);
            // Find oldest entry
            for (int i = 0; i < MAX_AIRCRAFT; i++)
                if (g_aircraft_map.entries[i].icao[0] != '\0' && g_aircraft_map.entries[i].last_seen < oldest_time) {
                    oldest_time = g_aircraft_map.entries[i].last_seen;
                    oldest_idx  = i;
                }
            if (oldest_idx >= 0) {
                g_aircraft_map.entries[oldest_idx].icao[0] = '\0';
                g_aircraft_map.count--;
                to_remove--;
            } else
                break;
        }
    }

    strncpy(g_aircraft_map.entries[index].icao, icao, 6);
    g_aircraft_map.entries[index].icao[6]   = '\0';
    g_aircraft_map.entries[index].timestamp = 0;
    g_aircraft_map.count++;

    return &g_aircraft_map.entries[index];
}

void aircraft_position_update(const char *const icao, const double lat, const double lon, const int altitude_ft, const time_t timestamp) {
    const double distance = calculate_distance_nm(g_config.position_lat, g_config.position_lon, lat, lon);

    if (!validate_position(lat, lon, altitude_ft, distance)) {
        g_stats.position_invalid++;
        if (g_config.debug)
            printf("debug: aircraft position: invalid icao=%s, lat=%.6f, lon=%.6f, alt=%d, dist=%.1f\n", icao, lat, lon, altitude_ft, distance);
        return;
    }

    g_stats.position_valid++;

    pthread_mutex_lock(&g_aircraft_map.mutex);
    aircraft_t *const aircraft = aircraft_find_or_create(icao);
    if (!aircraft) {
        pthread_mutex_unlock(&g_aircraft_map.mutex);
        printf("error: hash table full, cannot add %s\n", icao);
        return;
    }
    aircraft->last_seen = timestamp;
    if (aircraft->timestamp == 0 || distance > aircraft->distance) {
        if (g_config.debug && aircraft->timestamp != 0)
            printf("debug: aircraft position: update icao=%s, dist %.1f -> %.1f nm\n", icao, aircraft->distance, distance);
        aircraft->lat         = lat;
        aircraft->lon         = lon;
        aircraft->altitude_ft = altitude_ft;
        aircraft->distance    = distance;
        aircraft->timestamp   = timestamp;
    }
    pthread_mutex_unlock(&g_aircraft_map.mutex);

    if (distance > g_stats.distance_max) {
        g_stats.distance_max = distance;
        strncpy(g_stats.distance_max_icao, icao, 6);
        g_stats.distance_max_icao[6] = '\0';
    }

    if ((double)altitude_ft > g_stats.altitude_max) {
        g_stats.altitude_max = (double)altitude_ft;
        strncpy(g_stats.altitude_max_icao, icao, 6);
        g_stats.altitude_max_icao[6] = '\0';
    }
}

void aircraft_publish_mqtt(void) {
    if (!g_mosq)
        return;

    const time_t now = time(NULL);
    char json_buffer[65536 * 2];
    int offset                            = 0;
    unsigned long updates                 = 0;
    unsigned char published[MAX_AIRCRAFT] = { 0 };

    offset +=
        snprintf(json_buffer + offset, sizeof(json_buffer) - (size_t)offset, "{\"timestamp\":%ld,\"position_lat\":%.6f,\"position_lon\":%.6f,\"aircraft\":[",
                 time(NULL), g_config.position_lat, g_config.position_lon);

    pthread_mutex_lock(&g_aircraft_map.mutex);
    for (int i = 0; i < MAX_AIRCRAFT; i++)
        if (g_aircraft_map.entries[i].icao[0] != '\0' && g_aircraft_map.entries[i].timestamp != 0 &&
            g_aircraft_map.entries[i].published < g_aircraft_map.entries[i].timestamp) {
            if (updates > 0)
                offset += snprintf(json_buffer + offset, sizeof(json_buffer) - (size_t)offset, ",");
            offset += snprintf(json_buffer + offset, sizeof(json_buffer) - (size_t)offset,
                               "{\"icao\":\"%s\",\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld}", g_aircraft_map.entries[i].icao,
                               g_aircraft_map.entries[i].lat, g_aircraft_map.entries[i].lon, g_aircraft_map.entries[i].altitude_ft,
                               g_aircraft_map.entries[i].distance, g_aircraft_map.entries[i].timestamp);
            updates++;
            published[i]++;
            if (offset > (int)sizeof(json_buffer) - 200)
                break;
        }
    pthread_mutex_unlock(&g_aircraft_map.mutex);

    offset += snprintf(json_buffer + offset, sizeof(json_buffer) - (size_t)offset, "]}");
    if (updates > 0) {
        const int rc = mosquitto_publish(g_mosq, NULL, g_config.mqtt_topic, (int)strlen(json_buffer), json_buffer, 0, false);
        if (rc == MOSQ_ERR_SUCCESS) {
            g_stats.published_mqtt += updates;
            for (int i = 0; i < MAX_AIRCRAFT; i++) // locking not needed
                if (published[i] > 0)
                    g_aircraft_map.entries[i].published = now;
        } else
            printf("mqtt: %lu aircraft updated publish failed: %s\n", updates, mosquitto_strerror(rc));
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

bool adsb_parse_sbs_position(const char *const line, char *const icao, double *const lat, double *const lon, int *const altitude) {
    char *fields[24];
    char buf[MAX_LINE_LENGTH];
    strncpy(buf, line, MAX_LINE_LENGTH - 1);
    buf[MAX_LINE_LENGTH - 1] = '\0';

    int i       = 0;
    char *p     = buf;
    char *start = p;
    while (*p && i < 24) {
        if (*p == ',') {
            *p          = '\0';
            fields[i++] = start;
            start       = p + 1;
        }
        p++;
    }
    if (i < 24 && start < p)
        fields[i++] = start;
    if (i < 16)
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
        printf("adsb: connection to %s:%d failed (socket): %s\n", g_config.adsb_host, g_config.adsb_port, strerror(errno));
        return -1;
    }
    struct sockaddr_in servaddr = {
        .sin_family      = AF_INET,
        .sin_port        = htons(g_config.adsb_port),
        .sin_addr.s_addr = inet_addr(adsb_host),
    };
    if (connect(sockfd, (struct sockaddr *)&servaddr, sizeof(servaddr)) < 0) {
        printf("adsb: connection to %s:%d failed (connect): %s\n", g_config.adsb_host, g_config.adsb_port, strerror(errno));
        close(sockfd);
        return -1;
    }
    printf("adsb: connection to %s:%d succeeded\n", g_config.adsb_host, g_config.adsb_port);
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
                        g_stats.messages_total++;

                    char icao[7];
                    double lat, lon;
                    int altitude;
                    if (adsb_parse_sbs_position(line, icao, &lat, &lon, &altitude)) {
                        g_stats.messages_position++;
                        aircraft_position_update(icao, lat, lon, altitude, time(NULL));
                    }
                    line_pos = 0;
                }
            } else if (line_pos < MAX_LINE_LENGTH - 1)
                line[line_pos++] = buffer[i];
        }

        const time_t now = time(NULL);
        if (now - g_last_mqtt >= g_config.mqtt_interval) {
            aircraft_publish_mqtt();
            g_last_mqtt = now;
        }
    }

    adsb_disconnect(sockfd);

    printf("analyser: stopped\n");

    return NULL;
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

void mqtt_on_connect(struct mosquitto *mosq __attribute__((unused)), void *obj __attribute__((unused)), int rc) {
    if (rc == 0)
        printf("mqtt: connection to %s:%d succeeded\n", g_config.mqtt_host, g_config.mqtt_port);
    else
        printf("mqtt: connection to %s:%d failed (mosquitto error): %s\n", g_config.mqtt_host, g_config.mqtt_port, mosquitto_strerror(rc));
}

bool mqtt_begin(void) {
    char mqtt_host[MAX_NAME_LENGTH];
    if (!host_resolve(g_config.mqtt_host, mqtt_host, sizeof(mqtt_host)))
        return false;
    mosquitto_lib_init();
    g_mosq = mosquitto_new(DEFAULT_MQTT_CLIENT_ID, true, NULL);
    if (!g_mosq) {
        mosquitto_lib_cleanup();
        printf("mqtt: connection to %s:%d failed (could not create mosquitto instance)\n", g_config.mqtt_host, g_config.mqtt_port);
        return false;
    }
    mosquitto_connect_callback_set(g_mosq, mqtt_on_connect);
    const int rc = mosquitto_connect(g_mosq, mqtt_host, g_config.mqtt_port, 60);
    if (rc != MOSQ_ERR_SUCCESS) {
        printf("mqtt: connection to %s:%d failed (mosquitto error): %s\n", g_config.mqtt_host, g_config.mqtt_port, mosquitto_strerror(rc));
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

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

void print_status(void) {
    printf(
        "status: messages=%lu, positions=%lu (valid=%lu, invalid=%lu), aircraft=%d, distance-max=%.1fnm (%s), altitude-max=%.0fft (%s), published-mqtt=%lu\n",
        g_stats.messages_total, g_stats.messages_position, g_stats.position_valid, g_stats.position_invalid, g_aircraft_map.count, g_stats.distance_max,
        g_stats.distance_max_icao, g_stats.altitude_max, g_stats.altitude_max_icao, g_stats.published_mqtt);
    fflush(stdout);
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

void print_help(const char *const prog_name) {
    printf("usage: %s [OPTIONS]\n", prog_name);
    printf("options:\n");
    printf("  --help                Show this help message\n");
    printf("  --debug               Enable debug output\n");
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
            g_config.mqtt_interval = atoi(optarg);
            if (g_config.mqtt_interval <= 0) {
                fprintf(stderr, "invalid mqtt interval: %s\n", optarg);
                return -1;
            }
            break;
        case 's':
            g_config.status_interval = atoi(optarg);
            if (g_config.status_interval <= 0) {
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

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------

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

    printf("config: adsb=%s:%d, mqtt=%s:%d, mqtt-topic=%s, mqtt-interval=%ds, status-interval=%ds, distance-max=%.0fnm, altitude=max=%.0fft, "
           "position=%.6f,%0.6f, debug=%s\n",
           g_config.adsb_host, g_config.adsb_port, g_config.mqtt_host, g_config.mqtt_port, g_config.mqtt_topic, g_config.mqtt_interval,
           g_config.status_interval, g_config.distance_max_nm, g_config.altitude_max_ft, g_config.position_lat, g_config.position_lon,
           g_config.debug ? "yes" : "no");

    g_last_status = time(NULL);
    g_last_mqtt   = time(NULL);
    if (!mqtt_begin())
        return 1;
    pthread_mutex_init(&g_aircraft_map.mutex, NULL);
    pthread_t processing_thread;
    if (pthread_create(&processing_thread, NULL, adsb_processing_thread, NULL) != 0) {
        perror("pthread_create");
        return 1;
    }

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);
    signal(SIGPIPE, SIG_IGN); // Ignore broken pipe
    while (g_running) {
        const time_t now = time(NULL);
        if (now - g_last_status >= g_config.status_interval) {
            print_status();
            g_last_status = now;
        }
        sleep(1);
    }

    pthread_join(processing_thread, NULL);
    mqtt_end();
    pthread_mutex_destroy(&g_aircraft_map.mutex);

    print_status();
    return 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------
