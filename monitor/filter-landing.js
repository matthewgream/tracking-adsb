// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateGroundIntersect(lat, lon, rad, aircraft) {
    if (!aircraft.lat || !aircraft.lon || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude || !aircraft.baro_rate) return undefined;
    if (aircraft.calculated.altitude === 0 || aircraft.calculated.altitude === 'ground') return undefined;
    const getMinDescentRate = (aircraft) => {
        switch (aircraft.category) {
            case 'A0': // No information
            case 'A1': // Light aircraft (<15.5k lbs)
                return -200; // Lighter aircraft can land with shallower descent
            case 'A2': // Small (15.5-75k lbs)
                return -250;
            case 'A3': // Large (75-300k lbs)
            case 'A4': // High-Vortex Large (B757)
            case 'A5': // Heavy (>300k lbs)
                return -300;
            case 'A7': // Rotorcraft
                return -100; // Helicopters can have very shallow descents
            case 'B1': // Glider
                return -150; // Gliders have shallow descent rates
            case 'B4': // Ultralight
                return -150;
            case 'B6': // UAV/Drone
                return -100;
            default:
                return -250; // Conservative default
        }
    };
    const minDescentRate = getMinDescentRate(aircraft);
    if (aircraft.baro_rate > minDescentRate) return undefined;
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
        if (aircraft.calculated.altitude < this.conf.altitude && aircraft.calculated.distance < this.conf.distance) {
            const landing = calculateGroundIntersect(this.extra.data.location.lat, this.extra.data.location.lon, this.conf.radius, aircraft);
            if (landing && landing.willIntersectGround) {
                landing.airports = this.extra.data.airports.findNearby(landing.groundLat, landing.groundLon);
                landing.isPossibleLanding = landing.airports.length > 0;
                aircraft.calculated.landing = landing;
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.landing.willIntersectGround,
    sort: (a, b) => {
        const aIsUnexpected = !a.calculated.landing.isPossibleLanding;
        const bIsUnexpected = !b.calculated.landing.isPossibleLanding;
        if (aIsUnexpected && !bIsUnexpected) return -1;
        if (!aIsUnexpected && bIsUnexpected) return 1;
        return a.calculated.landing.groundSeconds - b.calculated.landing.groundSeconds;
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
        const [airport] = aircraft.calculated.landing.airports;
        const { name, icao } = airport || {};
        const displayName = (() => {
            if (name && icao) return `${icao} [${name}]`;
            if (name) return name;
            if (icao) return icao;
            return '';
        })();
        return {
            text: `approaching ${displayName || 'airport'}`,
            landingInfo: {
                groundPosition: aircraft.calculated.landing.groundPosition,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
