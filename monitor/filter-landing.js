// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'landing',
    name: 'Aircraft landing detection',
    enabled: true,
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
        a = a.calculated.landing;
        b = b.calculated.landing;
        const aIsUnexpected = !a.isPossibleLanding,
            bIsUnexpected = !b.isPossibleLanding;
        if (aIsUnexpected && !bIsUnexpected) return -1;
        if (!aIsUnexpected && bIsUnexpected) return 1;
        return a.groundSeconds - b.groundSeconds;
    },
    getStats: (aircrafts) => {
        const list = aircrafts.filter((a) => a.calculated.landing.isLanding);
        return {
            ...this.extra.format.getStats_List('aircraft-landing', list),
            landingCount: list.filter((a) => a.calculated.landing.isPossibleLanding).length,
            unknownCount: list.filter((a) => !a.calculated.landing.isPossibleLanding).length,
        };
    },
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
