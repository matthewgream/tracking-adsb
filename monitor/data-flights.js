// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function fixup(data) {
    data.aircraft?.forEach((aircraft) => {
        aircraft.flight = aircraft.flight ? aircraft.flight.trim() : `[${aircraft.hex}]`;
    });
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
                else if (!/^application\/json/.test(res.headers['content-type']))
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
