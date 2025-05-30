// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const MAPPING_EXPIRY_TIME = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const hexToFlightMap = new Map(),
    flightToHexMap = new Map(),
    hexTimestamps = new Map();

function cleanupMappings() {
    const expiryTime = Date.now() - MAPPING_EXPIRY_TIME;
    const expiredHexes = [];
    hexTimestamps.forEach((timestamp, hex) => {
        if (timestamp < expiryTime) expiredHexes.push(hex);
    });
    expiredHexes.forEach((hex) => {
        const flight = hexToFlightMap.get(hex);
        hexToFlightMap.delete(hex);
        hexTimestamps.delete(hex);
        if (flight && flightToHexMap.get(flight) === hex) flightToHexMap.delete(flight);
    });
    return expiredHexes.length;
}

function updateMappings(hex, flight) {
    const now = Date.now();
    const previousHex = flightToHexMap.get(flight);
    if (previousHex && previousHex !== hex) {
        hexToFlightMap.delete(previousHex);
        hexTimestamps.delete(previousHex);
    }
    hexToFlightMap.set(hex, flight);
    flightToHexMap.set(flight, hex);
    hexTimestamps.set(hex, now);
}

function statsMappings() {
    const now = Date.now();
    let oldestTimestamp, newestTimestamp, oldestHex, newestHex;
    hexTimestamps.forEach((timestamp, hex) => {
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
        mapSize: hexToFlightMap.size,
        oldestEntry: oldestTimestamp
            ? {
                  hex: oldestHex,
                  flight: hexToFlightMap.get(oldestHex),
                  age: Math.round((now - oldestTimestamp) / 1000), // age in seconds
                  timestamp: new Date(oldestTimestamp).toISOString(),
              }
            : undefined,
        newestEntry: newestTimestamp
            ? {
                  hex: newestHex,
                  flight: hexToFlightMap.get(newestHex),
                  age: Math.round((now - newestTimestamp) / 1000), // age in seconds
                  timestamp: new Date(newestTimestamp).toISOString(),
              }
            : undefined,
        expiryTime: MAPPING_EXPIRY_TIME / 1000, // expiry time in seconds
        uniqueFlights: flightToHexMap.size,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function initialise(options) {
    function fixup(data) {
        let replaceCount = 0,
            updatedCount = 0;
        const cleanedCount = cleanupMappings();
        data.aircraft?.forEach((aircraft) => {
            if (aircraft.flight) aircraft.flight = aircraft.flight.trim();
            if (aircraft.flight && aircraft.hex) {
                const existingFlight = hexToFlightMap.get(aircraft.hex);
                if (existingFlight !== aircraft.flight) {
                    updateMappings(aircraft.hex, aircraft.flight);
                    updatedCount++;
                }
            }
            if (!aircraft.flight) {
                if (aircraft.hex && hexToFlightMap.has(aircraft.hex)) {
                    aircraft.flight = hexToFlightMap.get(aircraft.hex);
                    replaceCount++;
                } else {
                    aircraft.flight = `[${aircraft.hex}]`;
                }
            }
        });
        if (options?.debug && (replaceCount > 0 || updatedCount > 0 || cleanedCount > 0)) {
            const parts = [];
            if (replaceCount > 0) parts.push(`substituted=${replaceCount}`);
            if (updatedCount > 0) parts.push(`updated=${updatedCount}`);
            if (cleanedCount > 0) parts.push(`cleaned=${cleanedCount}`);
            console.log(`[EXPERIMENTAL] hex/flight mapping: ${parts.join(', ')} (map size: ${hexToFlightMap.size})`);
        }
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

    return {
        fetch,
        stats: statsMappings,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = function (options) {
    return initialise(options);
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
