// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// const helpers = require('./filter-helpers.js');

const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js'), ...require('./tools-formats.js') };
const aircraft_info = require('./aircraft-info.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLandingDetails(lat, lon, rad, aircraft, trajectoryData = undefined) {
    // ===== 1. Input validation and screening =====

    const observerCheck = tools.validateCoordinates(lat, lon).valid;
    if (!observerCheck.valid) return { error: `Observer ${observerCheck.error}` };
    const radiusCheck = tools.validateNumber(rad, 0, 1000, 'radius').valid;
    if (!radiusCheck.valid) return { error: radiusCheck.error };
    const required = {
        lat: aircraft.lat,
        lon: aircraft.lon,
        track: aircraft.track,
        gs: aircraft.gs,
        altitude: aircraft.calculated?.altitude,
        baro_rate: aircraft.baro_rate,
    };
    for (const [key, value] of Object.entries(required)) if (value === undefined || value === null) return { error: `Missing required field: ${key}` };
    const aircraftCheck = tools.validateCoordinates(aircraft.lat, aircraft.lon).valid;
    if (!aircraftCheck.valid) return { error: `Aircraft ${aircraftCheck.error}` };
    const trackCheck = tools.validateNumber(aircraft.track, 0, 360, 'track').valid;
    if (!trackCheck.valid) return { error: trackCheck.error };
    const speedCheck = tools.validateNumber(aircraft.gs, 0, 1000, 'ground speed').valid;
    if (!speedCheck.valid) return { error: speedCheck.error };
    const altCheck = tools.validateNumber(aircraft.calculated.altitude, 0, 60000, 'altitude').valid;
    if (!altCheck.valid) return { error: altCheck.error };
    if (aircraft.calculated.altitude === 0) return { error: 'Aircraft already on ground' };
    const minDescentRate = aircraft_info.getMinDescentRate(aircraft.category);
    if (aircraft.baro_rate > minDescentRate) return { error: `Not descending fast enough: ${aircraft.baro_rate} > ${minDescentRate} ft/min` };

    // ===== 2. Core calculations =====

    const descentRate = Math.abs(aircraft.baro_rate); // ft/min
    const timeToGroundMinutes = aircraft.calculated.altitude / descentRate;
    const timeToGroundSeconds = Math.round(timeToGroundMinutes * 60);
    const groundSpeedKmMin = tools.knotsToKmPerMin(aircraft.gs).value;
    const distanceToTravel = groundSpeedKmMin * timeToGroundMinutes;
    const projectedPosition = tools.calculateProjectedPosition(aircraft.lat, aircraft.lon, distanceToTravel, aircraft.track);
    const groundDistance = tools.calculateDistance(lat, lon, projectedPosition.lat, projectedPosition.lon).distance;
    if (groundDistance > rad) return { error: `Projected landing point ${groundDistance.toFixed(1)}km exceeds radius ${rad}km`, groundDistance, projectedPosition };
    const groundTime = new Date(Date.now() + timeToGroundSeconds * 1000);
    const groundPosition = tools.calculateRelativePosition(lat, lon, projectedPosition.lat, projectedPosition.lon, aircraft.track);

    // ===== 3. Prepare return data =====

    const result = {
        isLanding: true,
        groundLat: Number(projectedPosition.lat.toFixed(6)),
        groundLon: Number(projectedPosition.lon.toFixed(6)),
        groundDistance: Number(groundDistance.toFixed(3)),
        groundSeconds: timeToGroundSeconds,
        groundTime,
        groundPosition,
        //
        descentRate,
        timeToGroundMinutes: Number(timeToGroundMinutes.toFixed(2)),
        distanceToTravel: Number(distanceToTravel.toFixed(3)),
        currentAltitude: aircraft.calculated.altitude,
        currentSpeed: aircraft.gs,
    };

    // ===== 4. Multi-point trajectory analysis (future use) =====

    if (trajectoryData?.positions?.length >= 2) {
        const trajectoryAnalysis = analyzeTrajectoryConsistency(aircraft, trajectoryData, projectedPosition);
        result.trajectoryConfidence = trajectoryAnalysis.confidence;
        result.trajectoryAnalysis = trajectoryAnalysis;
    }

    return result;
}

function analyzeTrajectoryConsistency(aircraft, trajectoryData, projectedPosition) {
    const { positions } = trajectoryData;
    const recentPositions = positions.slice(-5); // Last 5 positions
    if (recentPositions.length < 2) return { confidence: 0.5, reason: 'Insufficient data' };
    const bearings = [];
    for (let i = 1; i < recentPositions.length; i++) bearings.push(tools.calculateBearing(recentPositions[i - 1].lat, recentPositions[i - 1].lon, recentPositions[i].lat, recentPositions[i].lon).bearing);
    const avgBearing = bearings.reduce((a, b) => a + b, 0) / bearings.length;
    const bearingVariance =
        bearings.reduce((sum, b) => {
            const diff = Math.abs(b - avgBearing);
            return sum + (diff > 180 ? 360 - diff : diff) ** 2;
        }, 0) / bearings.length;
    const isTurning = bearingVariance > 100; // threshold in degrees²
    const descentRates = trajectoryData.descentRates || [];
    const avgDescentRate = descentRates.reduce((a, b) => a + b, 0) / descentRates.length;
    const descentVariance = descentRates.reduce((sum, r) => sum + (r - avgDescentRate) ** 2, 0) / descentRates.length;
    let confidence = 1;
    if (isTurning) confidence *= 0.7; // Reduce confidence if turning
    if (descentVariance > 10000) confidence *= 0.8; // Reduce confidence if descent rate varies (ft/min² threshold)
    const lastPositions = recentPositions.slice(-3);
    const projectedBearing = tools.calculateBearing(lastPositions[0].lat, lastPositions[0].lon, projectedPosition.lat, projectedPosition.lon).bearing;
    const currentBearing = aircraft.track;
    const bearingDiff = Math.abs(projectedBearing - currentBearing);
    const normalizedBearingDiff = bearingDiff > 180 ? 360 - bearingDiff : bearingDiff;
    if (normalizedBearingDiff > 30) confidence *= 0.6; // Significant reduction if trajectory doesn't align
    return {
        confidence: Math.max(0, Math.min(1, confidence)),
        isTurning,
        bearingVariance: Number(bearingVariance.toFixed(2)),
        descentVariance: Number(descentVariance.toFixed(2)),
        trajectoryAlignment: normalizedBearingDiff < 30,
        dataPoints: recentPositions.length,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
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
    const landing = calculateLandingDetails(lat, lon, conf.radius, aircraft, trajectoryData);
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
            text: `approaching ${tools.formatAirport(airport) || 'airport'}`,
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
