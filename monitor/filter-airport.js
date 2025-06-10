// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAirportsNearby(extra, aircraft) {
    if (aircraft.lat === undefined || aircraft.lon === undefined) return undefined;
    const airports = extra.data.airports.findNearby(aircraft.lat, aircraft.lon, { altitude: aircraft.calculated?.altitude });
    if (airports.length === 0) return undefined;
    return { hasAirportsNearby: true, airports };
}

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
        aircraft.calculated.airports_nearby = { hasAirportsNearby: false };
        const airports_nearby = detectAirportsNearby(this.extra, aircraft);
        if (airports_nearby) aircraft.calculated.airports_nearby = airports_nearby;
    },
    evaluate: (aircraft) => aircraft.calculated.airports_nearby.hasAirportsNearby,
    sort: (a, b) => {
        const a_ = a.calculated.airports_nearby,
            b_ = b.calculated.airports_nearby;
        return b_.airports.length - a_.airports.length;
    },
    getStats: (aircrafts, list) => {
        const byAirport = list.map((aircraft) => aircraft.calculated.airports_nearby.airports[0].icao_code).reduce((counts, icao_code) => ({ ...counts, [icao_code]: (counts[icao_code] || 0) + 1 }), {});
        return {
            byAirport,
        };
    },
    format: (aircraft) => {
        const { airports_nearby } = aircraft.calculated;
        const [airport] = airports_nearby.airports;
        return {
            text: `near ${this.extra.format.formatAirport(airport) || 'airport'}`,
            warn: this.conf.priorities?.includes(airport.icao_code),
        };
    },
    debug: (type, aircraft) => {
        const { airports_nearby } = aircraft.calculated;
        if (type == 'sorting') return `airports=${airports_nearby.airports.length}`;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
