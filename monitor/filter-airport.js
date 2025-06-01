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
        aircraft.calculated.airports_nearby = { hasAirportsNearby: false };
        if (aircraft.lat !== undefined && aircraft.lon !== undefined) {
            const airports = this.extra.data.airports.findNearby(aircraft.lat, aircraft.lon, { altitude: aircraft.calculated?.altitude });
            if (airports.length > 0) aircraft.calculated.airports_nearby = { hasAirportsNearby: true, airports };
        }
    },
    evaluate: (aircraft) => aircraft.calculated.airports_nearby.hasAirportsNearby,
    sort: (a, b) => {
        const a_ = a.calculated.airports_nearby,
            b_ = b.calculated.airports_nearby;
        if (!a_.hasAirportsNearby) return 1;
        if (!b_.hasAirportsNearby) return -1;
        //
        return b_.ariports.length - a_.airports.length;
    },
    getStats: (aircrafts, list) => {
        const byAirport = list
            .map((aircraft) => aircraft.calculated.airports_nearby.airports[0].icao)
            .reduce((counts, icao) => ({ ...counts, [icao]: (counts[icao] || 0) + 1 }), {});
        return {
            byAirport,
        };
    },
    format: (aircraft) => {
        const { airports_nearby } = aircraft.calculated;
        const [airport] = airports_nearby.airports;
        return {
            text: `near ${this.extra.format.formatAirport(airport) || 'airport'}`,
            warn: this.conf.priorities?.includes(airport.icao),
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
