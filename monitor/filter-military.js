// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'military',
    name: 'Aircraft military',
    enabled: true,
    priority: 6,
    config: (conf, extra) => {
        this.extra = extra;
        this.militaryPrefixes = ['RRR', 'VVV', 'RCH'];
    },
    preprocess: (aircraft) => {
        aircraft.calculated.is_military = false;
        if (aircraft.flight && this.militaryPrefixes.some((prefix) => aircraft.flight.trim().startsWith(prefix))) aircraft.calculated.is_military = true;
        if (aircraft.flight && /^[A-Z]{4}[0-9]{2}$/.test(aircraft.flight)) aircraft.calculated.is_military = true;
    },
    evaluate: (aircraft) => {
        return aircraft.calculated.is_military;
    },
    sort: (a, b) => a.calculated.distance - b.calculated.distance,
    getStats: (aircrafts) =>
        this.extra.format.getStats_List(
            'aircraft-military',
            aircrafts.filter((a) => a.calculated.is_military)
        ),
    format: (_) => {
        return {
            text: `military`,
            warn: true,
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
