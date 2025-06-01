// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'lifting',
    name: 'Aircraft lifting detection',
    priority: 2, // Same priority as landing
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.lifting = { isLifting: false };
        if (!this.conf.altitude || aircraft.calculated?.altitude < this.conf.altitude) {
            const { lat, lon } = this.extra.data.location;
            const lifting = helpers.calculateLiftingTrajectory(lat, lon, aircraft);
            if (lifting?.isLifting) {
                lifting.nearbyAirports = this.extra.data.airports.findNearby(aircraft.lat, aircraft.lon, {
                    distance: this.conf.radius,
                });
                lifting.hasKnownOrigin = lifting.nearbyAirports.length > 0;
                if (lifting.hasKnownOrigin) [lifting.departureAirport] = lifting.nearbyAirports;
                aircraft.calculated.lifting = lifting;
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.lifting.isLifting,
    sort: (a, b) => {
        const a_ = a.calculated.lifting,
            b_ = b.calculated.lifting;
        if (!a_.isLifting) return 1;
        if (!b_.isLifting) return -1;
        //
        return b_.liftingScore - a_.liftingScore;
    },
    getStats: (aircrafts, list) => {
        const byAirport = list
            .filter((a) => a.calculated.lifting.hasKnownOrigin)
            .map((a) => a.calculated.lifting.departureAirport?.name || a.calculated.lifting.departureAirport?.icao)
            .reduce((counts, airport) => ({ ...counts, [airport]: (counts[airport] || 0) + 1 }), {});
        return {
            knownOriginCount: list.filter((a) => a.calculated.lifting.hasKnownOrigin).length,
            unknownOriginCount: list.filter((a) => !a.calculated.lifting.hasKnownOrigin).length,
            byAirport,
        };
    },
    format: (aircraft) => {
        const { lifting } = aircraft.calculated;
        const airportName = this.extra.format.formatAirport(lifting.hasKnownOrigin ? lifting.departureAirport : undefined);
        return {
            text: `climbing${airportName ? ' from ' + airportName : ''} at ${lifting.climbRate} ft/min`,
            liftingInfo: {
                departureAirport: lifting.departureAirport,
                departureTime: lifting.departureTime,
                climbRate: lifting.climbRate,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
