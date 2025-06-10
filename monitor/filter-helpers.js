// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };
const aircraft_info = require('./aircraft-info.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const SEVERITY_LEVELS = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
};

function getHighestSeverity(items, severityField = 'severity') {
    if (!items || items.length === 0) return 'info';

    return items.reduce((highest, item) => {
        const itemSeverity = item[severityField];
        return SEVERITY_LEVELS[itemSeverity] > SEVERITY_LEVELS[highest] ? itemSeverity : highest;
    }, 'info');
}

function compareSeverity(a, b, severityField = 'severity') {
    return SEVERITY_LEVELS[b[severityField]] - SEVERITY_LEVELS[a[severityField]];
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateDistance(lat1, lon1, lat2, lon2) {
    return tools.calculateDistance(lat1, lon1, lat2, lon2).distance;
}
function calculateBearing(lat1, lon1, lat2, lon2) {
    return tools.calculateBearing(lat1, lon1, lat2, lon2).bearing;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function willPathsIntersect(aircraft1, aircraft2, lookaheadSeconds = 300) {
    if (!aircraft1.lat || !aircraft1.lon || !aircraft1.track || !aircraft1.gs || !aircraft2.lat || !aircraft2.lon || !aircraft2.track || !aircraft2.gs) {
        return { intersects: false, error: 'Missing required data' };
    }
    // Project both aircraft positions forward
    const speed1 = tools.knotsToKmPerMin(aircraft1.gs).value / 60; // km/s
    const speed2 = tools.knotsToKmPerMin(aircraft2.gs).value / 60; // km/s
    // Check at multiple time points
    const timeSteps = 10;
    const stepSize = lookaheadSeconds / timeSteps;
    let minDistance = Infinity;
    let minDistanceTime = 0;
    for (let t = 0; t <= lookaheadSeconds; t += stepSize) {
        const pos1 = tools.calculateProjectedPosition(aircraft1.lat, aircraft1.lon, speed1 * t, aircraft1.track);
        const pos2 = tools.calculateProjectedPosition(aircraft2.lat, aircraft2.lon, speed2 * t, aircraft2.track);
        const distance = calculateDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
        if (distance < minDistance) {
            minDistance = distance;
            minDistanceTime = t;
        }
    }
    return {
        intersects: minDistance < 5, // Within 5km
        minDistance,
        timeToClosest: minDistanceTime,
        closestPoint1: tools.calculateProjectedPosition(aircraft1.lat, aircraft1.lon, speed1 * minDistanceTime, aircraft1.track),
        closestPoint2: tools.calculateProjectedPosition(aircraft2.lat, aircraft2.lon, speed2 * minDistanceTime, aircraft2.track),
    };
}

function predictTrajectory(aircraftData, secondsAhead = 60) {
    const positions = aircraftData.getPositions({ maxDataPoints: 10 });
    if (positions.length < 2) return undefined;
    // Simple linear prediction based on recent velocity
    const recent = positions.slice(-2);
    const timeDiff = (recent[1].timestamp - recent[0].timestamp) / 1000;
    const distance = calculateDistance(recent[0].lat, recent[0].lon, recent[1].lat, recent[1].lon);
    const bearing = calculateBearing(recent[0].lat, recent[0].lon, recent[1].lat, recent[1].lon);
    const velocity = distance / (timeDiff / 3600); // km/h
    const predictedDistance = (velocity * secondsAhead) / 3600; // km
    const predicted = tools.calculateProjectedPosition(recent[1].lat, recent[1].lon, predictedDistance, bearing);
    // Predict altitude if available
    let predictedAltitude;
    if (recent[0].altitude !== undefined && recent[1].altitude !== undefined) {
        const altRate = (recent[1].altitude - recent[0].altitude) / timeDiff; // ft/s
        predictedAltitude = recent[1].altitude + altRate * secondsAhead;
        predictedAltitude = Math.max(0, predictedAltitude); // Don't go below ground
    }
    return {
        position: predicted,
        altitude: predictedAltitude,
        confidence: positions.length / 10, // More history = more confidence
        basedOnPoints: positions.length,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateWind(groundSpeed, trueAirspeed, track, heading) {
    if (!groundSpeed || !trueAirspeed || track === undefined || heading === undefined) return { windSpeed: undefined, windDirection: undefined };
    // Convert to radians
    const trackRad = tools.deg2rad(track).value;
    const headingRad = tools.deg2rad(heading).value;
    // Calculate wind vector
    const windX = groundSpeed * Math.sin(trackRad) - trueAirspeed * Math.sin(headingRad);
    const windY = groundSpeed * Math.cos(trackRad) - trueAirspeed * Math.cos(headingRad);
    const windSpeed = Math.hypot(windX, windY);
    const windDirection = tools.normalizeDegrees((Math.atan2(windX, windY) * 180) / Math.PI + 180);
    return {
        windSpeed: Math.round(windSpeed),
        windDirection: Math.round(windDirection),
        headwind: Math.round(-windSpeed * Math.cos(tools.deg2rad(windDirection - heading).value)),
        crosswind: Math.round(windSpeed * Math.sin(tools.deg2rad(windDirection - heading).value)),
    };
}

function analyzeTurn(aircraftData, minTrackChange = 5) {
    const { values: tracks, timestamps } = aircraftData.getField('track');
    if (tracks.length < 3) return { inTurn: false };
    // Calculate track changes
    const trackChanges = [];
    for (let i = 1; i < tracks.length; i++) {
        let change = tracks[i] - tracks[i - 1];
        // Normalize to -180 to 180
        if (change > 180) change -= 360;
        if (change < -180) change += 360;
        trackChanges.push({
            change,
            timestamp: timestamps[i],
            duration: (timestamps[i] - timestamps[i - 1]) / 1000,
        });
    }
    // Find current turn
    const recentChanges = trackChanges.slice(-5);
    const totalChange = recentChanges.reduce((sum, tc) => sum + tc.change, 0);
    const turnDirection = totalChange > 0 ? 'right' : 'left';
    const avgRate = totalChange / recentChanges.reduce((sum, tc) => sum + tc.duration, 0);
    if (Math.abs(totalChange) > minTrackChange)
        return {
            inTurn: true,
            direction: turnDirection,
            totalDegrees: Math.abs(totalChange),
            turnRate: avgRate, // degrees per second
            estimatedBankAngle: Math.min(30, Math.abs(avgRate) * 3), // Rough estimate
        };
    return { inTurn: false };
}

function getEnergyTrend(rate) {
    if (rate > 10) return 'gaining';
    if (rate < -10) return 'losing';
    return 'maintaining';
}
function calculateEnergyState(aircraft) {
    if (!aircraft.calculated?.altitude || !aircraft.gs) return undefined;
    const altitudeMeters = aircraft.calculated.altitude * 0.3048;
    const speedMs = aircraft.gs * 0.514444; // knots to m/s
    // Simplified energy calculation (would need mass for true energy)
    const potentialEnergy = 9.81 * altitudeMeters; // m²/s² per kg
    const kineticEnergy = 0.5 * speedMs * speedMs; // m²/s² per kg
    const totalSpecificEnergy = potentialEnergy + kineticEnergy;
    // Energy rate if we have vertical speed
    let energyRate;
    if (aircraft.baro_rate !== undefined) {
        const verticalSpeedMs = aircraft.baro_rate * 0.00508; // ft/min to m/s
        energyRate = 9.81 * verticalSpeedMs + speedMs * (aircraft.acceleration || 0);
    }
    return {
        specificEnergy: Math.round(totalSpecificEnergy),
        energyRate: energyRate ? Math.round(energyRate) : undefined,
        energyTrend: getEnergyTrend(energyRate),
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLandingTrajectory(lat, lon, rad, aircraft, trajectoryData = undefined) {
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
    const groundDistance = calculateDistance(lat, lon, projectedPosition.lat, projectedPosition.lon);
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
    for (let i = 1; i < recentPositions.length; i++) bearings.push(calculateBearing(recentPositions[i - 1].lat, recentPositions[i - 1].lon, recentPositions[i].lat, recentPositions[i].lon));
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
    const projectedBearing = calculateBearing(lastPositions[0].lat, lastPositions[0].lon, projectedPosition.lat, projectedPosition.lon);
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

function calculateLiftingTrajectory(lat, lon, aircraft, trajectoryData = undefined) {
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
        for (let i = 1; i < recentPositions.length; i++) tracks.push(calculateBearing(recentPositions[i - 1].lat, recentPositions[i - 1].lon, recentPositions[i].lat, recentPositions[i].lon));
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
        const departureDistance = calculateDistance(lat, lon, liftingResult.projectedLat, liftingResult.projectedLon);
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

function calculateOverheadTrajectory(lat, lon, alt, aircraft, trajectoryData = undefined) {
    // ===== 1. Input validation and screening =====

    const observerCheck = tools.validateCoordinates(lat, lon).valid;
    if (!observerCheck.valid) return { error: `Observer ${observerCheck.error}` };
    const altCheck = tools.validateNumber(alt, -1000, 10000, 'observer altitude (meters)').valid;
    if (!altCheck.valid) return { error: altCheck.error };
    const required = {
        lat: aircraft.lat,
        lon: aircraft.lon,
        track: aircraft.track,
        gs: aircraft.gs,
        altitude: aircraft.calculated?.altitude,
    };
    for (const [key, value] of Object.entries(required)) if (value === undefined || value === null) return { error: `Missing required field: ${key}` };
    const aircraftCheck = tools.validateCoordinates(aircraft.lat, aircraft.lon).valid;
    if (!aircraftCheck.valid) return { error: `Aircraft ${aircraftCheck.error}` };
    const validations = [tools.validateNumber(aircraft.track, 0, 360, 'track').valid, tools.validateNumber(aircraft.gs, 0, 2000, 'ground speed').valid, tools.validateNumber(aircraft.calculated.altitude, 0, 60000, 'altitude').valid];
    for (const check of validations) if (!check.valid) return { error: check.error };

    // ===== 2. Core calculations =====

    const stationAltitudeFeet = alt * 3.28084;
    const speedKmMin = tools.knotsToKmPerMin(aircraft.gs).value;
    const crossTrackResult = calculateCrossTrackDistance(lat, lon, aircraft.lat, aircraft.lon, aircraft.track);
    if (crossTrackResult.error) return { error: crossTrackResult.error };
    const { crossTrackDistance, alongTrackDistance, isApproaching } = crossTrackResult;
    const overheadDistance = Math.abs(crossTrackDistance);
    const overheadSeconds = Math.round(Math.abs(alongTrackDistance / speedKmMin) * 60);
    const overheadTime = new Date(Date.now() + (isApproaching ? overheadSeconds : -overheadSeconds) * 1000);
    const approachBearing = tools.normalizeDegrees(aircraft.track + (crossTrackDistance >= 0 ? 90 : -90));
    const overheadAltitude = aircraft.baro_rate && isApproaching ? aircraft.calculated.altitude : Math.max(0, Math.round(aircraft.calculated.altitude + (aircraft.baro_rate / 60) * overheadSeconds));
    const relativeAltitude = overheadAltitude - stationAltitudeFeet;
    const slantRange = tools.calculateSlantRange(overheadDistance, relativeAltitude).range;
    const verticalAngle = tools.calculateVerticalAngle(overheadDistance, relativeAltitude, lat).angle;

    // ===== 3. Prepare return data =====

    const result = {
        willIntersectOverhead: true,
        overheadFuture: isApproaching,
        overheadDistance: Number(overheadDistance.toFixed(3)),
        overheadSeconds,
        overheadTime,
        overheadAltitude,
        relativeAltitude,
        stationAltitude: stationAltitudeFeet,
        slantRange: Number(slantRange.toFixed(3)),
        verticalRate: aircraft.baro_rate || undefined,
        approachBearing: Number(approachBearing.toFixed(1)),
        approachCardinal: tools.bearingToCardinal(approachBearing),
        verticalAngle: Number(verticalAngle.toFixed(1)),
        crossTrackDistance: Number(crossTrackDistance.toFixed(3)),
        alongTrackDistance: Number(alongTrackDistance.toFixed(3)),
        currentDistance: calculateDistance(lat, lon, aircraft.lat, aircraft.lon),
    };

    // ===== 4. Multi-point trajectory analysis (future use) =====

    if (trajectoryData?.positions?.length >= 2) {
        const trajectoryAnalysis = analyzeOverheadTrajectory(aircraft, trajectoryData, result, lat, lon);
        result.trajectoryConfidence = trajectoryAnalysis.confidence;
        result.trajectoryAnalysis = trajectoryAnalysis;
    }

    return result;
}

function calculateCrossTrackDistance(obsLat, obsLon, aircraftLat, aircraftLon, aircraftTrack) {
    const gcDistance = calculateDistance(obsLat, obsLon, aircraftLat, aircraftLon);
    if (gcDistance < 0.001) return { crossTrackDistance: 0, alongTrackDistance: 0, isApproaching: false };
    const bearingToObs = calculateBearing(aircraftLat, aircraftLon, obsLat, obsLon);
    const trackBearingDiff = tools.normalizeDegrees(bearingToObs - aircraftTrack);
    const trackBearingDiffRad = tools.deg2rad(trackBearingDiff).value;
    const crossTrackDistance = gcDistance * Math.sin(trackBearingDiffRad);
    const alongTrackDistance = gcDistance * Math.cos(trackBearingDiffRad);
    const isApproaching = Math.abs(trackBearingDiff) < 90;
    return {
        crossTrackDistance,
        alongTrackDistance: Math.abs(alongTrackDistance),
        isApproaching,
    };
}

function analyzeOverheadTrajectory(aircraft, trajectoryData, overheadResult, stationLat, stationLon) {
    const { positions, tracks = [], altitudes = [] } = trajectoryData;
    if (positions.length < 3) return { confidence: 0.5, reason: 'Insufficient data points' };
    let confidence = 1;
    const factors = {};
    if (tracks.length >= 3) {
        const avgTrack = tracks.reduce((a, b) => a + b, 0) / tracks.length;
        const trackVariance =
            tracks.reduce((sum, t) => {
                const diff = Math.abs(t - avgTrack);
                return sum + (diff > 180 ? 360 - diff : diff) ** 2;
            }, 0) / tracks.length;
        factors.trackStability = trackVariance < 25;
        if (!factors.trackStability) confidence *= 0.7;
    }
    const recentPositions = positions.slice(-5);
    if (recentPositions.length >= 3) {
        const crossTrackDistances = recentPositions.map((pos) => {
            const result = calculateCrossTrackDistance(stationLat, stationLon, pos.lat, pos.lon, aircraft.track);
            return Math.abs(result.crossTrackDistance);
        });
        const minCrossTrack = Math.min(...crossTrackDistances);
        const maxCrossTrack = Math.max(...crossTrackDistances);
        factors.trajectoryConverging = maxCrossTrack - minCrossTrack > 0.5;
        if (!factors.trajectoryConverging && overheadResult.overheadDistance > 2) confidence *= 0.6;
    }
    if (aircraft.baro_rate && altitudes.length >= 3) {
        const recentAltitudes = altitudes.slice(-3);
        const altitudeChanges = [];
        for (let i = 1; i < recentAltitudes.length; i++) altitudeChanges.push(recentAltitudes[i] - recentAltitudes[i - 1]);
        const avgAltChange = altitudeChanges.reduce((a, b) => a + b, 0) / altitudeChanges.length;
        factors.altitudeConsistent = Math.sign(avgAltChange) === Math.sign(aircraft.baro_rate);
        if (!factors.altitudeConsistent) confidence *= 0.8;
    }
    return {
        confidence: Math.max(0, Math.min(1, confidence)),
        factors,
        dataPoints: positions.length,
        trackPoints: tracks.length,
        altitudePoints: altitudes.length,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateClosureDetails(aircraft, other) {
    // ===== 1. Input validation and screening =====

    const required = {
        aircraft_lat: aircraft?.lat,
        aircraft_lon: aircraft?.lon,
        aircraft_track: aircraft?.track,
        aircraft_gs: aircraft?.gs,
        other_lat: other?.lat,
        other_lon: other?.lon,
        other_track: other?.track,
        other_gs: other?.gs,
    };
    for (const [key, value] of Object.entries(required)) if (value === undefined || value === null) return { error: `Missing required field: ${key}`, closureRate: undefined, closureTime: undefined };
    const aircraftCheck = tools.validateCoordinates(aircraft.lat, aircraft.lon).valid;
    if (!aircraftCheck.valid) return { error: `Aircraft 1 ${aircraftCheck.error}`, closureRate: undefined, closureTime: undefined };
    const otherCheck = tools.validateCoordinates(other.lat, other.lon).valid;
    if (!otherCheck.valid) return { error: `Aircraft 2 ${otherCheck.error}`, closureRate: undefined, closureTime: undefined };
    const validations = [
        tools.validateNumber(aircraft.track, 0, 360, 'aircraft 1 track').valid,
        tools.validateNumber(aircraft.gs, 0, 2000, 'aircraft 1 ground speed').valid,
        tools.validateNumber(other.track, 0, 360, 'aircraft 2 track').valid,
        tools.validateNumber(other.gs, 0, 2000, 'aircraft 2 ground speed').valid,
    ];
    for (const check of validations) if (!check.valid) return { error: check.error, closureRate: undefined, closureTime: undefined };

    // ===== 2. Core calculations =====

    const velocityComponents1 = tools.calculateVelocityComponents(aircraft.track, aircraft.gs);
    const velocityComponents2 = tools.calculateVelocityComponents(other.track, other.gs);
    const relativeVelocity = { x: velocityComponents2.x - velocityComponents1.x, y: velocityComponents2.y - velocityComponents1.y };
    const closureRate = Math.hypot(relativeVelocity.x, relativeVelocity.y);
    const currentDistance = calculateDistance(aircraft.lat, aircraft.lon, other.lat, other.lon);
    const bearing = calculateBearing(aircraft.lat, aircraft.lon, other.lat, other.lon);
    const closureAnalysis = tools.calculateClosureGeometry(aircraft, other, relativeVelocity, bearing, currentDistance);
    let closureTime, closestApproach;
    if (closureAnalysis.valid && Math.abs(closureAnalysis.closureVelocity) > 0.1) {
        const timeToClosest = closureAnalysis.timeToClosestApproach;
        if (timeToClosest > 0 && timeToClosest < 600) {
            closureTime = timeToClosest;
            const closestPoint1 = tools.calculateProjectedPosition(aircraft.lat, aircraft.lon, tools.knotsToKmPerMin(aircraft.gs).value * (timeToClosest / 60), aircraft.track),
                closestPoint2 = tools.calculateProjectedPosition(other.lat, other.lon, tools.knotsToKmPerMin(other.gs).value * (timeToClosest / 60), other.track);
            closestApproach = {
                distance: calculateDistance(closestPoint1.lat, closestPoint1.lon, closestPoint2.lat, closestPoint2.lon),
                timeSeconds: timeToClosest,
                position1: closestPoint1,
                position2: closestPoint2,
            };
        } else if (timeToClosest < 0) closureTime = timeToClosest;
    }

    // ===== 3. Prepare return data =====

    return {
        closureRate: Number(closureRate.toFixed(1)),
        closureTime: closureTime ? Number(closureTime.toFixed(0)) : undefined,
        currentDistance: Number(currentDistance.toFixed(3)),
        bearing: Number(bearing.toFixed(1)),
        relativeVelocity: {
            x: Number(relativeVelocity.x.toFixed(1)),
            y: Number(relativeVelocity.y.toFixed(1)),
        },
        closureVelocity: closureAnalysis.valid ? Number(closureAnalysis.closureVelocity.toFixed(1)) : undefined,
        isConverging: closureAnalysis.valid ? closureAnalysis.closureVelocity < 0 : undefined,
        closestApproach,
        geometry: {
            bearingDiff: Number(closureAnalysis.bearingDiff.toFixed(1)),
            aspectAngle: Number(closureAnalysis.aspectAngle.toFixed(1)),
            crossingAngle: Number(closureAnalysis.crossingAngle.toFixed(1)),
        },
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    //
    SEVERITY_LEVELS,
    compareSeverity,
    getHighestSeverity,
    //
    calculateLandingTrajectory,
    calculateLiftingTrajectory,
    calculateClosureDetails,
    calculateOverheadTrajectory,
    willPathsIntersect,
    calculateWind,
    analyzeTurn,
    calculateEnergyState,
    predictTrajectory,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
