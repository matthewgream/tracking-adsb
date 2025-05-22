// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1),
        dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function airportATZradius(airport) {
    if (airport.radius) return airport.radius; // km
    if (airport.runwayLengthMax) return (airport.runwayLengthMax < 1850 ? 2.0 : 2.5) * 1.852;
    return (airport.iata?.trim() !== '' ? 2.5 : 2.0) * 1.852;
}
function airportATZaltitude(airport) {
    return (airport.elevation || 0) + (airport.height || 2000);
}

class airportsData {
    constructor(options) {
        this.data = require(options.source || 'airports-data.js');
    }

    length () {
	 return Object.keys (this.data).length;
    }

    findNearby(lat, lon, options = {}) {
        return Object.entries(this.data)
            .filter(([_, airport]) => airport.lat && airport.lon)
            .map(([_, airport]) => ({ ...airport, distance: calculateDistance(lat, lon, airport.lat, airport.lon) }))
            .filter((airport) => {
                if (options.distance && airport.distance <= options.distance) return true;
                if (airport.distance > airportATZradius(airport)) return false;
                if (options.altitude && airportATZaltitude(airport) < options.altitude) return false;
                return true;
            })
            .sort((a, b) => a.distance - b.distance);
    }

    apply(airports) {
        Object.entries(airports).forEach(([icao, airport]) => {
            if (!this.data[icao]) this.data[icao] = { icao };
            Object.assign(this.data[icao], airport);
            console.error(`airportsData: override [${icao}]: ${JSON.stringify(this.data[icao])}`);
        });
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = function (options) {
    return new airportsData(options);
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
