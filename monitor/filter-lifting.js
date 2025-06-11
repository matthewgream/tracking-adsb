// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// const helpers = require('./filter-helpers.js');
const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };
const aircraft_info = require('./aircraft-info.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLiftingScore(altitude, climbRate, groundSpeed) {
    // 1. Low altitude (weight higher at lower altitudes)
    const altitudeWeight = Math.max(0, 1 - altitude / 10000);
    // 2. Strong climb rate relative to altitude
    const climbWeight = altitude < 3000 ? 2 : 1;
    // 3. Reasonable ground speed for takeoff (not too slow, not too fast)
    const speedWeight = groundSpeed > 50 && groundSpeed < 250 ? 1.2 : 0.8;
    const score = ((climbWeight * climbRate) / 100) * altitudeWeight * speedWeight;
    return {
        score: Number(score.toFixed(3)),
        factors: {
            altitudeWeight: Number(altitudeWeight.toFixed(3)),
            climbWeight: Number(climbWeight.toFixed(3)),
            speedWeight: Number(speedWeight.toFixed(3)),
            climbRate,
            altitude,
        },
    };
}

function calculateLiftingDetails(lat, lon, aircraft, trajectoryData = undefined) {
    // ===== 1. Input validation and screening =====

    const observerCheck = tools.validateCoordinates(lat, lon).valid;
    if (!observerCheck.valid) return { error: `Observer ${observerCheck.error}` };
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
    const validations = [
        tools.validateNumber(aircraft.track, 0, 360, 'track').valid,
        tools.validateNumber(aircraft.gs, 0, 1000, 'ground speed').valid,
        tools.validateNumber(aircraft.calculated.altitude, 0, 50000, 'altitude').valid,
        tools.validateNumber(aircraft.baro_rate, -10000, 10000, 'climb rate').valid,
    ];
    for (const check of validations) if (!check.valid) return { error: check.error };
    const minClimbRate = aircraft_info.getMinClimbRate(aircraft.category);
    if (aircraft.baro_rate < minClimbRate)
        return {
            error: `Not climbing fast enough: ${aircraft.baro_rate} < ${minClimbRate} ft/min`,
            climbRate: aircraft.baro_rate,
            minClimbRate,
        };

    // ===== 2. Core calculations =====

    const liftingAnalysis = calculateLiftingScore(aircraft.calculated.altitude, aircraft.baro_rate, aircraft.gs);
    const scoreThreshold = 3; // Configurable threshold
    if (liftingAnalysis.score < scoreThreshold) return { error: `Lifting score ${liftingAnalysis.score.toFixed(2)} below threshold ${scoreThreshold}`, liftingAnalysis };
    const cruiseAltitude = aircraft_info.estimateCruiseAltitude(aircraft.calculated.altitude, aircraft.baro_rate, aircraft.category);
    const altitudeToClimb = cruiseAltitude - aircraft.calculated.altitude;
    const timeToReachCruiseMinutes = altitudeToClimb / aircraft.baro_rate;
    const projectionMinutes = Math.min(timeToReachCruiseMinutes, 15);
    const groundSpeedKmMin = tools.knotsToKmPerMin(aircraft.gs).value;
    const distanceToTravel = groundSpeedKmMin * projectionMinutes;
    const projectedPosition = tools.calculateProjectedPosition(aircraft.lat, aircraft.lon, distanceToTravel, aircraft.track);
    const relativePosition = tools.calculateRelativePosition(lat, lon, projectedPosition.lat, projectedPosition.lon, aircraft.track);
    const departureEstimate = aircraft_info.estimateDepartureTime(aircraft.calculated.altitude, aircraft.baro_rate, aircraft.category);

    // ===== 3. Prepare return data =====

    const result = {
        isLifting: true,
        departureAltitude: aircraft.calculated.altitude,
        climbRate: aircraft.baro_rate,
        currentSpeed: aircraft.gs,
        liftingScore: liftingAnalysis.score,
        scoreFactors: liftingAnalysis.factors,
        projectedLat: Number(projectedPosition.lat.toFixed(6)),
        projectedLon: Number(projectedPosition.lon.toFixed(6)),
        projectedPosition: relativePosition,
        projectedAltitude: Math.min(cruiseAltitude, aircraft.calculated.altitude + aircraft.baro_rate * projectionMinutes),
        departureTime: departureEstimate.departureTime,
        minutesSinceDeparture: departureEstimate.minutesSinceDeparture,
        assumedAvgClimbRate: departureEstimate.assumedAvgClimbRate,
        estimatedCruiseAltitude: cruiseAltitude,
        projectionMinutes: Number(projectionMinutes.toFixed(2)),
        distanceToTravel: Number(distanceToTravel.toFixed(3)),
    };

    // ===== 4. Multi-point trajectory analysis (future use) =====

    if (trajectoryData?.positions?.length >= 2) {
        const trajectoryAnalysis = analyzeLiftingTrajectory(aircraft, trajectoryData, result);
        result.trajectoryConfidence = trajectoryAnalysis.confidence;
        result.trajectoryAnalysis = trajectoryAnalysis;
    }

    return result;
}

function analyzeLiftingTrajectory(aircraft, trajectoryData, liftingResult) {
    const { positions, climbRates = [], altitudes = [] } = trajectoryData;
    if (positions.length < 3) return { confidence: 0.5, reason: 'Insufficient data points' };
    let confidence = 1;
    const factors = {};
    if (climbRates.length >= 3) {
        const avgClimbRate = climbRates.reduce((a, b) => a + b, 0) / climbRates.length;
        const climbVariance = climbRates.reduce((sum, r) => sum + (r - avgClimbRate) ** 2, 0) / climbRates.length;
        factors.climbConsistency = climbVariance < 50000; // ft/min² threshold
        if (!factors.climbConsistency) confidence *= 0.7;
    }
    if (altitudes.length >= 3) {
        let monotonic = true;
        for (let i = 1; i < altitudes.length; i++)
            if (altitudes[i] < altitudes[i - 1]) {
                monotonic = false;
                break;
            }
        factors.monotonicClimb = monotonic;
        if (!monotonic) confidence *= 0.5; // Significant penalty for altitude drops
    }
    const recentPositions = positions.slice(-5);
    if (recentPositions.length >= 3) {
        const tracks = [];
        for (let i = 1; i < recentPositions.length; i++) tracks.push(tools.calculateBearing(recentPositions[i - 1].lat, recentPositions[i - 1].lon, recentPositions[i].lat, recentPositions[i].lon).bearing);
        const avgTrack = tracks.reduce((a, b) => a + b, 0) / tracks.length;
        const trackVariance =
            tracks.reduce((sum, t) => {
                const diff = Math.abs(t - avgTrack);
                return sum + (diff > 180 ? 360 - diff : diff) ** 2;
            }, 0) / tracks.length;
        factors.trackConsistency = trackVariance < 100; // degrees² threshold
        if (!factors.trackConsistency) confidence *= 0.8;
    }
    const { estimatedDepartureLocation } = trajectoryData;
    if (estimatedDepartureLocation) {
        const { lat, lon } = estimatedDepartureLocation;
        const departureDistance = tools.calculateDistance(lat, lon, liftingResult.projectedLat, liftingResult.projectedLon).distance;
        factors.consistentDeparture = departureDistance < 5; // km threshold
        if (!factors.consistentDeparture) confidence *= 0.6;
    }
    return {
        confidence: Math.max(0, Math.min(1, confidence)),
        factors,
        dataPoints: positions.length,
        climbRatePoints: climbRates.length,
        altitudePoints: altitudes.length,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
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
    const lifting = calculateLiftingDetails(lat, lon, aircraft, trajectoryData);
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
