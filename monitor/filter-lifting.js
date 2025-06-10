// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectLifting(conf, extra, aircraft, aircraftData) {
    if (conf.altitude && (aircraft.calculated?.altitude === undefined || aircraft.calculated?.altitude > conf.altitude)) return undefined;
    const { lat, lon } = extra.data.location;
    // Pass aircraftData to get trajectory data for the helper
    const trajectoryData = aircraftData
        ? {
              positions: aircraftData.getPositions(),
              climbRates: aircraftData.getField('baro_rate').values,
              altitudes: aircraftData.getField('calculated.altitude').values,
          }
        : undefined;
    const lifting = helpers.calculateLiftingTrajectory(lat, lon, aircraft, trajectoryData);
    if (lifting?.isLifting) {
        lifting.nearbyAirports = extra.data.airports.findNearby(aircraft.lat, aircraft.lon, { distance: conf.radius });
        lifting.hasKnownOrigin = lifting.nearbyAirports.length > 0;
        if (lifting.hasKnownOrigin) [lifting.departureAirport] = lifting.nearbyAirports;
    }
    return lifting;
}
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
    preprocess: (aircraft, { aircraftData }) => {
        aircraft.calculated.lifting = { isLifting: false };
        const lifting = detectLifting(this.conf, this.extra, aircraft, aircraftData);
        if (lifting) aircraft.calculated.lifting = lifting;
    },
    evaluate: (aircraft) => aircraft.calculated.lifting.isLifting,
    sort: (a, b) => {
        const a_ = a.calculated.lifting,
            b_ = b.calculated.lifting;
        return b_.liftingScore - a_.liftingScore;
    },
    getStats: (aircrafts, list) => {
        const byAirport = list
            .filter((a) => a.calculated.lifting.hasKnownOrigin)
            .map((a) => a.calculated.lifting.departureAirport?.name || a.calculated.lifting.departureAirport?.icao_code)
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
    debug: (type, aircraft) => {
        const { lifting } = aircraft.calculated;
        if (type == 'sorting') return `score=${lifting.liftingScore.toFixed(2)}`;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
