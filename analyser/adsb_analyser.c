#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <time.h>
#include <errno.h>
#include <math.h>
#include <mosquitto.h>

#define DUMP1090_HOST       "192.168.0.49"
#define DUMP1090_PORT       30003
#define MQTT_HOST           "localhost"
#define MQTT_PORT           1883
#define MQTT_TOPIC          "adsb/scanner"
#define MQTT_CLIENT_ID      "adsb_scanner"
#define MAX_LINE_LENGTH     512
#define MQTT_INTERVAL_SEC   (5 * 60)    // Send updates every 10 seconds
#define STATUS_INTERVAL_SEC 60          // 1 minute
#define EARTH_RADIUS_NM     3440.065    // Earth radius in nautical miles

// Limits for sanity checks
#define MAX_DISTANCE_NM 1000.0
#define MAX_ALTITUDE_FT 75000.0
#define MIN_ALTITUDE_FT -1500.0
#define MIN_LAT         -90.0
#define MAX_LAT         90.0
#define MIN_LON         -180.0
#define MAX_LON         180.0

// Hash map configuration
#define MAX_AIRCRAFT    65536    // Power of 2 for fast modulo
#define HASH_MASK       (MAX_AIRCRAFT - 1)
#define PRUNE_THRESHOLD 0.95    // Start pruning at 95% capacity
#define PRUNE_RATIO     0.05    // Remove 5% of oldest entries

// Aircraft position entry
typedef struct {
    char icao [7];
    double lat;
    double lon;
    int altitude_ft;
    double distance;
    time_t timestamp;
    time_t last_seen;
    int updated;    // Flag to track if updated since last MQTT send
} aircraft_t;

// Global data structure - statically allocated
typedef struct {
    aircraft_t entries [MAX_AIRCRAFT];
    int count;
    double home_lat;
    double home_lon;
    pthread_mutex_t mutex;    // Need mutex for MQTT updates
} aircraft_map_t;

// Statistics
typedef struct {
    unsigned long total_messages;
    unsigned long position_messages;
    unsigned long valid_positions;
    unsigned long invalid_positions;
    unsigned long mqtt_updates_sent;
    double max_distance;
    double max_altitude;
    char max_distance_icao [7];
    char max_altitude_icao [7];
} stats_t;

// Global variables
aircraft_map_t g_aircraft_map = { 0 };
stats_t g_stats = { 0 };
volatile int g_running = 1;
time_t g_last_mqtt = 0;
time_t g_last_status = 0;
struct mosquitto *g_mosq = NULL;

// Simple hash function for ICAO hex codes
unsigned int hash_icao (const char *icao) {
    unsigned int hash = 0;
    for (int i = 0; i < 6 && icao [i]; i++)
        hash = hash * 31 + (unsigned int) icao [i];
    return hash & HASH_MASK;
}

// Calculate distance using Haversine formula (returns nautical miles)
double calculate_distance_nm (double lat1, double lon1, double lat2, double lon2) {
    double dlat = (lat2 - lat1) * M_PI / 180.0;
    double dlon = (lon2 - lon1) * M_PI / 180.0;
    lat1 = lat1 * M_PI / 180.0;
    lat2 = lat2 * M_PI / 180.0;
    double a = sin (dlat / 2) * sin (dlat / 2) + cos (lat1) * cos (lat2) * sin (dlon / 2) * sin (dlon / 2);
    double c = 2 * atan2 (sqrt (a), sqrt (1 - a));
    return EARTH_RADIUS_NM * c;
}

// Validate position data
int validate_position (double lat, double lon, int altitude_ft, double distance_nm) {
    if (lat < MIN_LAT || lat > MAX_LAT || lon < MIN_LON || lon > MAX_LON || altitude_ft > MAX_ALTITUDE_FT || altitude_ft < MIN_ALTITUDE_FT || distance_nm > MAX_DISTANCE_NM)
        return 0;    // Invalid
    // Additional sanity checks
    if (fabs (lat) < 0.01 && fabs (lon) < 0.01)
        return 0;    // Too close to 0,0 - likely bad data
    return 1;        // Valid
}

// Find or create aircraft entry
aircraft_t *find_or_create_aircraft (const char *icao) {
    unsigned int index = hash_icao (icao);
    unsigned int original_index = index;

    // Linear probing to find existing or empty slot
    while (g_aircraft_map.entries [index].icao [0] != '\0') {
        if (strcmp (g_aircraft_map.entries [index].icao, icao) == 0)
            return &g_aircraft_map.entries [index];    // Found existing
        index = (index + 1) & HASH_MASK;
        // Wrapped around - table full
        if (index == original_index)
            return NULL;
    }

    // Found empty slot - check if we need to prune
    if (g_aircraft_map.count >= MAX_AIRCRAFT * PRUNE_THRESHOLD) {
        // Prune oldest 5% of entries
        int to_remove = (int) ((double) MAX_AIRCRAFT * PRUNE_RATIO);
        time_t oldest_time = time (NULL);

        printf ("[PRUNE] Removing %d oldest entries\n", to_remove);

        while (to_remove > 0) {
            int oldest_idx = -1;
            oldest_time = time (NULL);
            // Find oldest entry
            for (int i = 0; i < MAX_AIRCRAFT; i++)
                if (g_aircraft_map.entries [i].icao [0] != '\0' && g_aircraft_map.entries [i].last_seen < oldest_time) {
                    oldest_time = g_aircraft_map.entries [i].last_seen;
                    oldest_idx = i;
                }
            if (oldest_idx >= 0) {
                g_aircraft_map.entries [oldest_idx].icao [0] = '\0';
                g_aircraft_map.count--;
                to_remove--;
            } else
                break;
        }
    }

    // Use the empty slot
    strncpy (g_aircraft_map.entries [index].icao, icao, 6);
    g_aircraft_map.entries [index].icao [6] = '\0';
    g_aircraft_map.entries [index].timestamp = 0;    // No valid position yet
    g_aircraft_map.count++;

    return &g_aircraft_map.entries [index];
}

// Update aircraft position if it's further than previous
void update_aircraft_position (const char *icao, double lat, double lon, int altitude_ft, time_t timestamp) {
    double distance = calculate_distance_nm (g_aircraft_map.home_lat, g_aircraft_map.home_lon, lat, lon);

    // Validate position
    if (! validate_position (lat, lon, altitude_ft, distance)) {
        g_stats.invalid_positions++;
        return;
    }

    g_stats.valid_positions++;

    pthread_mutex_lock (&g_aircraft_map.mutex);

    aircraft_t *aircraft = find_or_create_aircraft (icao);
    if (! aircraft) {
        printf ("[ERROR] Hash table full, cannot add %s\n", icao);
        pthread_mutex_unlock (&g_aircraft_map.mutex);
        return;
    }

    aircraft->last_seen = timestamp;

    // Update if this is the first position or if it's further from home
    if (aircraft->timestamp == 0 || distance > aircraft->distance) {
        aircraft->lat = lat;
        aircraft->lon = lon;
        aircraft->altitude_ft = altitude_ft;
        aircraft->distance = distance;
        aircraft->timestamp = timestamp;
        aircraft->updated = 1;    // Mark as updated for MQTT
    }

    // Update global max stats
    if (distance > g_stats.max_distance) {
        g_stats.max_distance = distance;
        strncpy (g_stats.max_distance_icao, icao, 6);
        g_stats.max_distance_icao [6] = '\0';
    }

    if ((double) altitude_ft > g_stats.max_altitude) {
        g_stats.max_altitude = (double) altitude_ft;
        strncpy (g_stats.max_altitude_icao, icao, 6);
        g_stats.max_altitude_icao [6] = '\0';
    }

    pthread_mutex_unlock (&g_aircraft_map.mutex);
}

// Send MQTT updates for changed aircraft
void send_mqtt_updates (void) {
    if (! g_mosq)
        return;

    char json_buffer [65536 * 2];    // Buffer for JSON message
    int offset = 0;
    unsigned long updates = 0;

    offset += snprintf (json_buffer + offset, sizeof (json_buffer) - (size_t) offset, "{\"timestamp\":%ld,\"home_lat\":%.6f,\"home_lon\":%.6f,\"aircraft\":[", time (NULL), g_aircraft_map.home_lat, g_aircraft_map.home_lon);

    pthread_mutex_lock (&g_aircraft_map.mutex);

    // Collect all updated aircraft
    for (int i = 0; i < MAX_AIRCRAFT; i++) {
        if (g_aircraft_map.entries [i].icao [0] != '\0' && g_aircraft_map.entries [i].timestamp != 0 && g_aircraft_map.entries [i].updated) {

            if (updates > 0)
                offset += snprintf (json_buffer + offset, sizeof (json_buffer) - (size_t) offset, ",");

            offset += snprintf (json_buffer + offset,
                                sizeof (json_buffer) - (size_t) offset,
                                "{\"icao\":\"%s\",\"lat\":%.6f,\"lon\":%.6f,\"alt\":%d,\"dist\":%.2f,\"time\":%ld}",
                                g_aircraft_map.entries [i].icao,
                                g_aircraft_map.entries [i].lat,
                                g_aircraft_map.entries [i].lon,
                                g_aircraft_map.entries [i].altitude_ft,
                                g_aircraft_map.entries [i].distance,
                                g_aircraft_map.entries [i].timestamp);

            g_aircraft_map.entries [i].updated = 0;    // Clear update flag
            updates++;

            // Prevent buffer overflow
            if (offset > (int) sizeof (json_buffer) - 200)
                break;
        }
    }

    pthread_mutex_unlock (&g_aircraft_map.mutex);

    offset += snprintf (json_buffer + offset, sizeof (json_buffer) - (size_t) offset, "]}");

    // Only send if there are updates
    if (updates > 0) {
        int rc = mosquitto_publish (g_mosq, NULL, MQTT_TOPIC, (int) strlen (json_buffer), json_buffer, 0, false);
        if (rc == MOSQ_ERR_SUCCESS) {
            g_stats.mqtt_updates_sent += updates;
            printf ("[MQTT] Sent %lu aircraft updates\n", updates);
        } else {
            printf ("[MQTT] Failed to publish: %s\n", mosquitto_strerror (rc));
        }
    }
}

// Print status line
void print_status (void) {
    printf ("[STATUS] Messages: %lu | Positions: %lu | Valid: %lu | Invalid: %lu | Aircraft: %d | MQTT sent: %lu | Max dist: %.1fnm (%s) | Max alt: %.0fft (%s)\n",
            g_stats.total_messages,
            g_stats.position_messages,
            g_stats.valid_positions,
            g_stats.invalid_positions,
            g_aircraft_map.count,
            g_stats.mqtt_updates_sent,
            g_stats.max_distance,
            g_stats.max_distance_icao,
            g_stats.max_altitude,
            g_stats.max_altitude_icao);
    fflush (stdout);
}

// Parse SBS message for position data
int parse_sbs_position (const char *line, char *icao, double *lat, double *lon, int *altitude) {
    char *fields [24];
    char buf [MAX_LINE_LENGTH];
    strncpy (buf, line, MAX_LINE_LENGTH - 1);
    buf [MAX_LINE_LENGTH - 1] = '\0';

    // Split by commas - handle empty fields
    int i = 0;
    char *p = buf;
    char *start = p;

    while (*p && i < 24) {
        if (*p == ',') {
            *p = '\0';
            fields [i++] = start;
            start = p + 1;
        }
        p++;
    }
    if (i < 24 && start < p)
        fields [i++] = start;

    // Need at least 16 fields for MSG,3 with position
    if (i < 16)
        return -1;

    // Check if it's a MSG type 3 (airborne position)
    if (strcmp (fields [0], "MSG") != 0 || strcmp (fields [1], "3") != 0)
        return -1;

    // Check if we have lat/lon (fields 14 and 15)
    if (strlen (fields [14]) == 0 || strlen (fields [15]) == 0)
        return -1;

    // Extract data
    strncpy (icao, fields [4], 6);
    icao [6] = '\0';
    *lat = atof (fields [14]);
    *lon = atof (fields [15]);
    *altitude = (fields [11] && strlen (fields [11]) > 0) ? atoi (fields [11]) : 0;

    return 0;
}

// Data processor thread
void *data_processor_thread (void *arg __attribute__ ((unused))) {
    int sockfd;
    struct sockaddr_in servaddr;
    char buffer [MAX_LINE_LENGTH];
    char line [MAX_LINE_LENGTH];
    int line_pos = 0;

    // Create socket
    sockfd = socket (AF_INET, SOCK_STREAM, 0);
    if (sockfd < 0) {
        perror ("socket");
        return NULL;
    }

    // Connect to dump1090
    memset (&servaddr, 0, sizeof (servaddr));
    servaddr.sin_family = AF_INET;
    servaddr.sin_port = htons (DUMP1090_PORT);
    servaddr.sin_addr.s_addr = inet_addr (DUMP1090_HOST);

    if (connect (sockfd, (struct sockaddr *) &servaddr, sizeof (servaddr)) < 0) {
        perror ("connect");
        close (sockfd);
        return NULL;
    }

    printf ("Connected to dump1090 on port %d\n", DUMP1090_PORT);
    printf ("Tracking furthest position for each aircraft...\n");

    // Read and process data
    while (g_running) {
        ssize_t n = recv (sockfd, buffer, sizeof (buffer) - 1, 0);
        if (n <= 0) {
            if (n < 0)
                perror ("recv");
            break;
        }

        // Process each character
        buffer [n] = '\0';
        for (int i = 0; i < n; i++) {
            if (buffer [i] == '\n' || buffer [i] == '\r') {
                if (line_pos > 0) {
                    line [line_pos] = '\0';
                    // Update total message count
                    if (strncmp (line, "MSG", 3) == 0)
                        g_stats.total_messages++;
                    // Parse position
                    char icao [7];
                    double lat, lon;
                    int altitude;
                    if (parse_sbs_position (line, icao, &lat, &lon, &altitude) == 0) {
                        g_stats.position_messages++;
                        update_aircraft_position (icao, lat, lon, altitude, time (NULL));
                    }
                    line_pos = 0;
                }
            } else if (line_pos < MAX_LINE_LENGTH - 1)
                line [line_pos++] = buffer [i];
        }

        // Check if we need to send MQTT updates
        time_t now = time (NULL);
        if (now - g_last_mqtt >= MQTT_INTERVAL_SEC) {
            send_mqtt_updates ();
            g_last_mqtt = now;
        }

        // Check if status needs to be printed
        if (now - g_last_status >= STATUS_INTERVAL_SEC) {
            print_status ();
            g_last_status = now;
        }
    }

    close (sockfd);
    return NULL;
}

// MQTT connection callback
void on_connect (struct mosquitto *mosq __attribute__ ((unused)), void *obj __attribute__ ((unused)), int rc) {
    if (rc == 0) {
        printf ("[MQTT] Connected to broker\n");
    } else {
        printf ("[MQTT] Connection failed: %s\n", mosquitto_strerror (rc));
    }
}

int main (int argc __attribute__ ((unused)), const char * argv[] __attribute__ ((unused))) {
    pthread_t processor_thread;

    memset (&g_aircraft_map, 0, sizeof (g_aircraft_map));
    g_aircraft_map.home_lat = 51.50092998192453;
    g_aircraft_map.home_lon = -0.20671121337722095;
    pthread_mutex_init (&g_aircraft_map.mutex, NULL);

    memset (&g_stats, 0, sizeof (g_stats));
    g_last_status = time (NULL);
    g_last_mqtt = time (NULL);

    printf ("ADS-B Furthest Position Tracker with MQTT\n");
    printf ("Home: %.4f,%.4f | Max distance: %.0fnm | Max altitude: %.0fft\n", g_aircraft_map.home_lat, g_aircraft_map.home_lon, MAX_DISTANCE_NM, MAX_ALTITUDE_FT);
    printf ("MQTT: %s:%d topic=%s\n", MQTT_HOST, MQTT_PORT, MQTT_TOPIC);

    // Initialize mosquitto
    mosquitto_lib_init ();
    g_mosq = mosquitto_new (MQTT_CLIENT_ID, true, NULL);
    if (! g_mosq) {
        fprintf (stderr, "Failed to create mosquitto instance\n");
        return 1;
    }

    mosquitto_connect_callback_set (g_mosq, on_connect);

    // Connect to MQTT broker
    if (mosquitto_connect (g_mosq, MQTT_HOST, MQTT_PORT, 60) != MOSQ_ERR_SUCCESS) {
        fprintf (stderr, "Unable to connect to MQTT broker\n");
        return 1;
    }

    // Start mosquitto loop
    mosquitto_loop_start (g_mosq);

    if (pthread_create (&processor_thread, NULL, data_processor_thread, NULL) != 0) {
        perror ("pthread_create processor");
        return 1;
    }

    while (1)
        getchar ();

    g_running = 0;
    pthread_join (processor_thread, NULL);

    mosquitto_loop_stop (g_mosq, true);
    mosquitto_destroy (g_mosq);
    mosquitto_lib_cleanup ();
    pthread_mutex_destroy (&g_aircraft_map.mutex);

    print_status ();
    printf ("Shutdown complete\n");
    return 0;
}
