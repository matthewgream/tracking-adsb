// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateGroundIntersect(lat, lon, rad, aircraft) {
    if (!aircraft.lat || !aircraft.lon || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude || !aircraft.baro_rate) return undefined;
    if (aircraft.calculated.altitude === 0 || aircraft.calculated.altitude === 'ground') return undefined;
    if (aircraft.baro_rate > -300) return undefined; // shallow descent
    const descentRate = Math.abs(aircraft.baro_rate);
    const timeToGround = aircraft.calculated.altitude / descentRate,
        groundSeconds = Math.round(timeToGround * 60);
    const groundSpeedKmMin = (aircraft.gs * 1.852) / 60;
    const distanceTraveled = groundSpeedKmMin * timeToGround; // km
    const trackRad = helpers.track2rad(aircraft.track);
    const dx = distanceTraveled * Math.cos(trackRad),
        dy = distanceTraveled * Math.sin(trackRad);
    const latPerKm = 1 / 111.32,
        lonPerKm = 1 / (111.32 * Math.cos(helpers.deg2rad(aircraft.lat))); // degrees per km, adjusted
    const groundLat = aircraft.lat + dy * latPerKm,
        groundLon = aircraft.lon + dx * lonPerKm;
    const groundDistance = helpers.calculateDistance(lat, lon, groundLat, groundLon);
    if (groundDistance > rad) return undefined;
    const groundTime = new Date(Date.now() + groundSeconds * 1000);
    const groundPosition = helpers.calculateRelativePosition(lat, lon, groundLat, groundLon, aircraft.track);
    return {
        willIntersectGround: true,
        groundLat: Number(groundLat.toFixed(6)),
        groundLon: Number(groundLon.toFixed(6)),
        groundDistance,
        groundSeconds,
        groundTime,
        groundPosition,
    };
}

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
        aircraft.calculated.landing = { willIntersectGround: false };
        if (aircraft.calculated.altitude < this.conf.tracking.landing.altitude && aircraft.calculated.distance < this.conf.tracking.landing.distance) {
            const landing = calculateGroundIntersect(this.conf.location.lat, this.conf.location.lon, this.conf.tracking.landing.radius, aircraft);
            if (landing && landing.willIntersectGround) {
                landing.airports = this.extra.data.airports.findNearby(landing.groundLat, landing.groundLon);
                landing.isPossibleLanding = landing.airports.length > 0;
                aircraft.calculated.landing = landing;
            }
        }
    },
    evaluate: (aircraft) => {
        return aircraft.calculated.landing.willIntersectGround;
    },
    sort: (a, b) => {
        const aIsUnexpected = !a.calculated.landing.isPossibleLanding,
            bIsUnexpected = !b.calculated.landing.isPossibleLanding;
        return aIsUnexpected !== bIsUnexpected ? (aIsUnexpected ? -1 : 1) : a.calculated.landing.groundSeconds - b.calculated.landing.groundSeconds;
    },
    getStats: (aircrafts) => {
        const list = aircrafts.filter((a) => a.calculated.landing.willIntersectGround);
        return {
            ...this.extra.format.getStats_List('aircraft-landing', list),
            landingCount: list.filter((a) => a.calculated.landing.isPossibleLanding).length,
            unknownCount: list.filter((a) => !a.calculated.landing.isPossibleLanding).length,
        };
    },
    format: (aircraft) => {
        if (!aircraft.calculated.landing.isPossibleLanding)
            return {
                text: `descending not near known airport, landing in ${Math.floor(aircraft.calculated.landing.groundSeconds / 60)}m`,
                warn: true,
                landingInfo: {
                    groundPosition: aircraft.calculated.landing.groundPosition,
                },
            };
        return {
            text: `approaching ${aircraft.calculated.landing.airports[0]?.name || 'airport'}`,
            landingInfo: {
                groundPosition: aircraft.calculated.landing.groundPosition,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
