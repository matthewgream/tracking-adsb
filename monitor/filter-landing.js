// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

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
    preprocess: (aircraft) => {
        aircraft.calculated.landing = { isLanding: false };
        if (aircraft.calculated?.altitude < this.conf.altitude && aircraft.calculated?.distance < this.conf.distance) {
            const { lat, lon } = this.extra.data.location;
            const landing = helpers.calculateLandingTrajectory(lat, lon, this.conf.radius, aircraft);
            if (landing?.isLanding) {
                landing.airports = this.extra.data.airports.findNearby(landing.groundLat, landing.groundLon);
                landing.isPossibleLanding = landing.airports.length > 0;
                aircraft.calculated.landing = landing;
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.landing.isLanding,
    sort: (a, b) => {
        const a_ = a.calculated.landing,
            b_ = b.calculated.landing;
        if (!a_.isLanding) return 1;
        if (!b_.isLanding) return -1;
        //
        if (a_.isPossibleLanding != b_.isPossibleLanding) return a_.isPossibleLanding && !b_.isPossibleLanding ? 1 : -1;
        return a_.groundSeconds - b_.groundSeconds;
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
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
