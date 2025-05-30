// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'airport',
    name: 'Aircraft near airport',
    priority: 5,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.airports_nearby = [];
        if (aircraft.lat !== undefined && aircraft.lon !== undefined)
            aircraft.calculated.airports_nearby = this.extra.data.airports.findNearby(aircraft.lat, aircraft.lon, { altitude: aircraft.calculated?.altitude });
    },
    evaluate: (aircraft) => aircraft.calculated.airports_nearby.length > 0,
    sort: (a, b) => {
        a = a.calculated.airports_nearby;
        b = b.calculated.airports_nearby;
        if (a.length === 0 && b.length === 0) return 0;
        if (a.length === 0) return 1;
        if (b.length === 0) return -1;
        return a[0].distance - b[0].distance;
    },
    getStats: (aircrafts, list) => {
        const byAirport = list
            .filter((aircraft) => aircraft.calculated.airports_nearby.length > 0)
            .map((aircraft) => aircraft.calculated.airports_nearby[0].icao)
            .reduce((counts, icao) => ({ ...counts, [icao]: (counts[icao] || 0) + 1 }), {});
        return {
            byAirport,
        };
    },
    format: (aircraft) => {
        const { airports_nearby } = aircraft.calculated;
        const [airport] = airports_nearby;
        return {
            text: `near ${this.extra.format.formatAirport(airport) || 'airport'}`,
            warn: this.conf.priorities?.includes(airport.icao),
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
