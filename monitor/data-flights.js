// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// Experimental: Map to track hex codes and their associated flight numbers
const hexToFlightMap = new Map();
function fixup(data) {
    let substitutionCount = 0;
    data.aircraft?.forEach((aircraft) => {
        if (aircraft.flight) aircraft.flight = aircraft.flight.trim();
        if (aircraft.flight && aircraft.hex) hexToFlightMap.set(aircraft.hex, aircraft.flight.trim());
        if (!aircraft.flight) {
            if (aircraft.hex && hexToFlightMap.has(aircraft.hex)) {
                aircraft.flight = hexToFlightMap.get(aircraft.hex);
                substitutionCount++;
            } else aircraft.flight = `[${aircraft.hex}]`;
        }
    });
    if (substitutionCount > 0)
        console.log(`[EXPERIMENTAL] Substituted flight codes for ${substitutionCount} aircraft using hex-to-flight mapping (map size: ${hexToFlightMap.size})`);
    return data;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// eslint-disable-next-line no-redeclare
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

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    fetch,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
