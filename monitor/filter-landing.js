// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectLanding(conf, extra, aircraft, aircraftData) {
    if (aircraft.calculated?.altitude === undefined || aircraft.calculated?.distance === undefined) return undefined;
    const { lat, lon } = extra.data.location;
    // Pass aircraftData to get trajectory data for the helper
    const trajectoryData = aircraftData
        ? {
              positions: aircraftData.getPositions(),
              descentRates: aircraftData.getField('baro_rate').values,
          }
        : undefined;
    const landing = helpers.calculateLandingTrajectory(lat, lon, conf.radius, aircraft, trajectoryData);
    if (landing?.isLanding) {
        landing.airports = extra.data.airports.findNearby(landing.groundLat, landing.groundLon);
        landing.isPossibleLanding = landing.airports.length > 0;
        aircraft.calculated.landing = landing;
    }
    return landing;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'landing',
    name: 'Aircraft landing detection',
    priority: 2,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft, { aircraftData }) => {
        aircraft.calculated.landing = { isLanding: false };
        const landing = detectLanding(this.conf, this.extra, aircraft, aircraftData);
        if (landing) aircraft.calculated.landing = landing;
    },
    evaluate: (aircraft) => aircraft.calculated.landing.isLanding,
    sort: (a, b) => {
        const a_ = a.calculated.landing,
            b_ = b.calculated.landing;
        if (a_.isPossibleLanding !== b_.isPossibleLanding) return b_.isPossibleLanding ? 1 : -1;
        const diff = a_.groundSeconds - b_.groundSeconds;
        if (diff == 0) return 0;
        return diff > 0 ? 1 : -1;
    },
    getStats: (aircrafts, list) => ({
        landingCount: list.filter((a) => a.calculated.landing.isPossibleLanding).length,
        unknownCount: list.filter((a) => !a.calculated.landing.isPossibleLanding).length,
    }),
    format: (aircraft) => {
        const { landing } = aircraft.calculated;
        if (!landing.isPossibleLanding)
            return {
                text: `descending not near known airport, landing in ${Math.floor(landing.groundSeconds / 60)}m`,
                warn: true,
                landingInfo: {
                    groundPosition: landing.groundPosition,
                },
            };
        const [airport] = landing.airports;
        return {
            text: `approaching ${this.extra.format.formatAirport(airport) || 'airport'}`,
            landingInfo: {
                groundPosition: landing.groundPosition,
            },
        };
    },
    debug: (type, aircraft) => {
        const { landing } = aircraft.calculated;
        if (type == 'sorting') return `${landing.isPossibleLanding ? 'known' : 'unknown'}, ${landing.groundSeconds}s`;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
