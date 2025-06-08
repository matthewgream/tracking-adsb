// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const fs = require('fs');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const MAPPINGS_EXPIRY_TIME_DEFAULT = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const MAPPINGS_FILENAME_DEFAULT = '.monitor-hextoflight.cache';
const MAPPINGS_SAVE_TIME_DEFAULT = 5 * 60 * 1000; // 5 minutes default
const MAPPINGS_VERSION = 1;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const mappingsHexToFlight = new Map(),
    mappingsFlightToHex = new Map(),
    mappingsHexToTime = new Map();
let mappingsFilename = MAPPINGS_FILENAME_DEFAULT,
    mappingsSaveTime = MAPPINGS_SAVE_TIME_DEFAULT,
    mappingsExpiryTime = MAPPINGS_EXPIRY_TIME_DEFAULT;

function mappingsSave(filename) {
    try {
        const data = {
            version: MAPPINGS_VERSION,
            timestamp: Date.now(),
            mappings: Object.fromEntries(mappingsHexToFlight.entries()),
            timestamps: Object.fromEntries(mappingsHexToTime.entries()),
        };
        fs.writeFileSync(filename, JSON.stringify(data));
        return true;
    } catch (e) {
        console.error(`mappings[hex/flight]: failed to save to ${filename}:`, e);
        return false;
    }
}

function mappingsLoad(filename) {
    try {
        if (!fs.existsSync(filename)) return false;
        const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (data.version !== MAPPINGS_VERSION) return false;
        mappingsHexToFlight.clear();
        mappingsFlightToHex.clear();
        mappingsHexToTime.clear();
        Object.entries(data.mappings).forEach(([hex, flight]) => {
            mappingsHexToFlight.set(hex, flight);
            if (!mappingsFlightToHex.has(flight)) mappingsFlightToHex.set(flight, hex);
        });
        Object.entries(data.timestamps).forEach(([hex, timestamp]) => mappingsHexToTime.set(hex, timestamp));
        mappingsCleanup();
        return true;
    } catch (e) {
        console.error(`mappings[hex/flight]: failed to load from ${filename}:`, e);
        return false;
    }
}

function mappingsInit(options) {
    if (options?.mappingsFilename) mappingsFilename = options.mappingsFilename;
    if (options?.mappingsSaveTimeMins) mappingsSaveTime = options.mappingsSaveTimeMins * 60 * 1000;
    if (options?.mappingsExpiryTimeDays) mappingsExpiryTime = options.mappingsExpiryTimeDays * 24 * 60 * 60 * 1000;
    let intervalId;
    if (mappingsLoad(mappingsFilename))
        if (options?.debug) console.error(`mappings[hex/flight]: loaded from ${mappingsFilename} (${mappingsHexToFlight.size} entries)`);
    if (mappingsSaveTime > 0) {
        intervalId = setInterval(() => {
            if (mappingsSave(mappingsFilename) && options?.debug)
                console.error(`mappings[hex/flight]: saved to ${mappingsFilename} (${mappingsHexToFlight.size} entries)`);
        }, mappingsSaveTime);
        intervalId.unref();
    }
    process.once('exit', () => {
        if (intervalId) clearInterval(intervalId);
        mappingsSave(mappingsFilename);
    });
    process.once('SIGINT', () => process.exit(0));
    process.once('SIGTERM', () => process.exit(0));
}

function mappingsCleanup() {
    const expiredTime = Date.now() - mappingsExpiryTime,
        expiredHexes = [];
    mappingsHexToTime.forEach((timestamp, hex) => {
        if (timestamp < expiredTime) expiredHexes.push(hex);
    });
    expiredHexes.forEach((hex) => {
        const flight = mappingsHexToFlight.get(hex);
        mappingsHexToFlight.delete(hex);
        mappingsHexToTime.delete(hex);
        if (flight && mappingsFlightToHex.get(flight) === hex) mappingsFlightToHex.delete(flight);
    });
    return expiredHexes.length;
}

function mappingsUpdate(hex, flight) {
    const now = Date.now();
    const previousHex = mappingsFlightToHex.get(flight);
    if (previousHex && previousHex !== hex) {
        mappingsHexToFlight.delete(previousHex);
        mappingsHexToTime.delete(previousHex);
    }
    mappingsHexToFlight.set(hex, flight);
    mappingsFlightToHex.set(flight, hex);
    mappingsHexToTime.set(hex, now);
}

function mappingStats() {
    const now = Date.now();
    let oldestTimestamp, newestTimestamp, oldestHex, newestHex;
    mappingsHexToTime.forEach((timestamp, hex) => {
        if (!oldestTimestamp || timestamp < oldestTimestamp) {
            oldestTimestamp = timestamp;
            oldestHex = hex;
        }
        if (!newestTimestamp || timestamp > newestTimestamp) {
            newestTimestamp = timestamp;
            newestHex = hex;
        }
    });
    return {
        mapSize: mappingsHexToFlight.size,
        oldestEntry: oldestTimestamp
            ? {
                  hex: oldestHex,
                  flight: mappingsHexToFlight.get(oldestHex),
                  age: Math.round((now - oldestTimestamp) / 1000), // age in seconds
                  timestamp: new Date(oldestTimestamp).toISOString(),
              }
            : undefined,
        newestEntry: newestTimestamp
            ? {
                  hex: newestHex,
                  flight: mappingsHexToFlight.get(newestHex),
                  age: Math.round((now - newestTimestamp) / 1000), // age in seconds
                  timestamp: new Date(newestTimestamp).toISOString(),
              }
            : undefined,
        expiredTime: mappingsExpiryTime / 1000, // expiry time in seconds
        uniqueFlights: mappingsFlightToHex.size,
    };
}

function mappingsReplaceAndUpdate(aircrafts, debug = false) {
    let replaceCount = 0,
        updatedCount = 0;
    const cleanedCount = mappingsCleanup();
    aircrafts?.forEach((aircraft) => {
        if (aircraft.flight) aircraft.flight = aircraft.flight.trim();
        if (aircraft.flight && aircraft.hex) {
            const flight = mappingsHexToFlight.get(aircraft.hex);
            if (flight !== aircraft.flight) {
                mappingsUpdate(aircraft.hex, aircraft.flight);
                updatedCount++;
            }
        }
        if (!aircraft.flight) {
            if (aircraft.hex && mappingsHexToFlight.has(aircraft.hex)) {
                aircraft.flight = mappingsHexToFlight.get(aircraft.hex);
                replaceCount++;
            } else aircraft.flight = `[${aircraft.hex}]`;
        }
    });
    if (debug && (replaceCount > 0 || updatedCount > 0 || cleanedCount > 0))
        console.error(`mappings[hex/flight]: replace=${replaceCount}, updated=${updatedCount}, cleaned=${cleanedCount} (${mappingsHexToFlight.size} entries)`);
    return aircrafts;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function initialise(options) {
    function fixup(data) {
        mappingsReplaceAndUpdate(data?.aircraft, options.debug);
        return data;
    }

    function fetch(link) {
        return new Promise((resolve, reject) => {
            const protocol = link.startsWith('https') ? require('https') : require('http');
            const req = protocol
                .get(link, { headers: { Accept: 'application/json' }, timeout: 15000 }, (res) => {
                    const { statusCode } = res;
                    let error;
                    if (statusCode !== 200) error = new Error(`Request Failed: Status Code: ${statusCode}`);
                    // eslint-disable-next-line unicorn/consistent-destructuring
                    else if (!/^application\/json/.test(res.headers['content-type']))
                        // eslint-disable-next-line unicorn/consistent-destructuring
                        error = new Error(`Invalid content-type: '${res.headers['content-type']}', expected 'application/json'`);
                    if (error) {
                        res.resume();
                        reject(error);
                        return;
                    }
                    res.setEncoding('utf8');
                    let rawData = '';
                    res.on('data', (chunk) => (rawData += chunk));
                    res.on('end', () => {
                        try {
                            resolve(fixup(JSON.parse(rawData)));
                        } catch (e) {
                            reject(e);
                        }
                    });
                })
                .on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });
        });
    }

    mappingsInit(options);

    return {
        fetch,
        stats: mappingStats,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = function (options) {
    return initialise(options);
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
