// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function validateNumber(value, min = -Infinity, max = Infinity, name = 'value') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { valid: false, error: `${name} is not a valid number` };
    if (value < min || value > max) return { valid: false, error: `${name} ${value} is out of bounds [${min}, ${max}]` };
    return { valid: true };
}

function validateCoordinates(lat, lon) {
    const latCheck = validateNumber(lat, -90, 90, 'latitude');
    if (!latCheck.valid) return latCheck;
    const lonCheck = validateNumber(lon, -180, 180, 'longitude');
    if (!lonCheck.valid) return lonCheck;
    return { valid: true };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const EARTH_RADIUS = 6371;

function nmToKm(nm) {
    return nm * 1.852;
}
function feetToKm(feet) {
    return feet * 0.0003048;
}
function knotsToKmPerMin(knots) {
    return nmToKm(knots) / 60;
}

function normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
}
function normalizeLon(lon) {
    const normalized = ((lon + 180) % 360) - 180;
    return normalized === -180 ? 180 : normalized;
}

function deg2rad(deg) {
    if (typeof deg !== 'number' || !Number.isFinite(deg)) return Number.NaN;
    return deg * (Math.PI / 180);
}
function track2rad(track) {
    if (typeof track !== 'number' || !Number.isFinite(track)) return Number.NaN;
    return deg2rad((450 - normalizeDeg(track)) % 360);
}
function calculateDistance(lat1, lon1, lat2, lon2) {
    if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return Number.NaN;
    if (Math.abs(lat1) > 90 || Math.abs(lat2) > 90) return Number.NaN;
    lon1 = normalizeLon(lon1);
    lon2 = normalizeLon(lon2);
    if (lat1 === lat2 && lon1 === lon2) return 0;
    const lat1Rad = deg2rad(lat1);
    const lat2Rad = deg2rad(lat2);
    const deltaLat = deg2rad(lat2 - lat1);
    const deltaLon = deg2rad(lon2 - lon1);
    const sinDeltaLat = Math.sin(deltaLat / 2);
    const sinDeltaLon = Math.sin(deltaLon / 2);
    const a = sinDeltaLat * sinDeltaLat + Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDeltaLon * sinDeltaLon;
    const aClamped = Math.min(1, Math.max(0, a));
    const c = 2 * Math.atan2(Math.sqrt(aClamped), Math.sqrt(1 - aClamped));
    return EARTH_RADIUS * c;
}
function calculateBearing(lat1, lon1, lat2, lon2) {
    if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return Number.NaN;
    if (Math.abs(lat1) > 90 || Math.abs(lat2) > 90) return Number.NaN;
    if (Math.abs(lon1) > 180 || Math.abs(lon2) > 180) return Number.NaN;
    const lat1Rad = deg2rad(lat1),
        lat2Rad = deg2rad(lat2);
    const lon1Rad = deg2rad(lon1),
        lon2Rad = deg2rad(lon2);
    const dLon = lon2Rad - lon1Rad;
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
}
function calculateRelativePosition(refLat, refLon, targetLat, targetLon, track) {
    if ([refLat, refLon, targetLat, targetLon].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return undefined;
    const distance = calculateDistance(refLat, refLon, targetLat, targetLon);
    const bearing = calculateBearing(refLat, refLon, targetLat, targetLon);
    if (!Number.isFinite(distance) || !Number.isFinite(bearing)) return undefined;
    let relativeTrack, approachingStation;
    if (typeof track === 'number' && Number.isFinite(track)) {
        relativeTrack = ((normalizeDeg(track) - bearing + 180) % 360) - 180;
        approachingStation = Math.abs(relativeTrack) < 90;
    }
    return {
        distance,
        bearing,
        relativeTrack,
        cardinalBearing: bearing2Cardinal(bearing),
        approachingStation,
    };
}
function projectPosition(lat, lon, distanceKm, bearingDeg) {
    const latRad = deg2rad(lat);
    const lonRad = deg2rad(lon);
    const bearingRad = deg2rad(bearingDeg);
    const angularDistance = distanceKm / EARTH_RADIUS;
    const latNewRad = Math.asin(Math.sin(latRad) * Math.cos(angularDistance) + Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad));
    const lonRadNew =
        lonRad +
        Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad), Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(latNewRad));
    let latNew = (latNewRad * 180) / Math.PI;
    let lonNew = (((lonRadNew * 180) / Math.PI + 540) % 360) - 180;
    return {
        lat: Math.max(-90, Math.min(90, latNew)),
        lon: lonNew,
    };
}
function calculateVerticalAngle(horizontalDistance, relativeAltitude, observerLat) {
    if (typeof horizontalDistance !== 'number' || !Number.isFinite(horizontalDistance) || horizontalDistance < 0) return Number.NaN;
    if (typeof relativeAltitude !== 'number' || !Number.isFinite(relativeAltitude)) return Number.NaN;
    if (typeof observerLat !== 'number' || !Number.isFinite(observerLat) || Math.abs(observerLat) > 90) return Number.NaN;
    const altitudeKm = feetToKm(relativeAltitude);
    if (horizontalDistance < 0.001) return relativeAltitude > 0 ? 90 : relativeAltitude < 0 ? -90 : 0;
    let angle = Math.atan2(altitudeKm, horizontalDistance) * (180 / Math.PI);
    if (horizontalDistance > 10) {
        const latRad = deg2rad(Math.abs(observerLat));
        const cosLat = Math.max(0.001, Math.cos(latRad));
        const curveCorrection = (horizontalDistance * horizontalDistance) / (12800 * cosLat);
        angle -= Math.atan2(curveCorrection, horizontalDistance) * (180 / Math.PI);
    }
    return Math.max(-90, Math.min(90, angle));
}
function calculateSlantRange(horizontalDistance, relativeAltitude) {
    if (typeof horizontalDistance !== 'number' || !Number.isFinite(horizontalDistance) || horizontalDistance < 0) return Number.NaN;
    if (typeof relativeAltitude !== 'number' || !Number.isFinite(relativeAltitude)) return Number.NaN;
    const altitudeKm = feetToKm(Math.abs(relativeAltitude));
    return Math.hypot(horizontalDistance, altitudeKm);
}
function bearing2Cardinal(bearing) {
    if (typeof bearing !== 'number' || !Number.isFinite(bearing)) return '';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round((normalizeDeg(bearing) + 11.25) / 22.5) % 16;
    return directions[index];
}
function calculateVelocityComponents(track, groundSpeed) {
    const trackRad = track2rad(track);
    return {
        x: groundSpeed * Math.cos(trackRad),
        y: groundSpeed * Math.sin(trackRad),
    };
}
function analyzeClosureGeometry(aircraft1, aircraft2, relativeVelocity, bearing, distance) {
    const bearingRad = deg2rad(bearing);
    const positionVector = {
        x: distance * Math.sin(bearingRad) * 111.32,
        y: distance * Math.cos(bearingRad) * 111.32,
    };
    const closureVelocity = -(relativeVelocity.x * positionVector.x + relativeVelocity.y * positionVector.y) / Math.hypot(positionVector.x, positionVector.y);
    const relativeSpeed = Math.hypot(relativeVelocity.x, relativeVelocity.y);
    let timeToClosestApproach;
    if (relativeSpeed > 0.1) {
        const dotProduct = positionVector.x * relativeVelocity.x + positionVector.y * relativeVelocity.y;
        timeToClosestApproach = ((-dotProduct / (relativeSpeed * relativeSpeed)) * 3600) / 1.852;
    }
    const track1 = aircraft1.track;
    const track2 = aircraft2.track;
    let bearingDiff = Math.abs(track2 - track1);
    if (bearingDiff > 180) bearingDiff = 360 - bearingDiff;
    let aspectAngle = Math.abs(bearing - track2);
    if (aspectAngle > 180) aspectAngle = 360 - aspectAngle;
    const crossingAngle = bearingDiff;
    return {
        valid: true,
        closureVelocity,
        timeToClosestApproach,
        bearingDiff,
        aspectAngle,
        crossingAngle,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function getMinDescentRate(aircraft) {
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
}

function getMinClimbRate(aircraft) {
    switch (aircraft.category) {
        case 'A0': // No information
        case 'A1': // Light aircraft (<15.5k lbs)
            return 200; // Light aircraft can take off with lower climb rates
        case 'A2': // Small (15.5-75k lbs)
            return 250;
        case 'A3': // Large (75-300k lbs)
        case 'A4': // High-Vortex Large (B757)
        case 'A5': // Heavy (>300k lbs)
            return 300; // Heavy aircraft need higher climb rates to be significant
        case 'A7': // Rotorcraft
            return 100; // Helicopters can have very low climb rates
        case 'B1': // Glider
            return 150; // Gliders have low climb rates
        case 'B4': // Ultralight
            return 150; // Ultralights climb slowly
        case 'B6': // UAV/Drone
            return 100; // Small drones
        default:
            return 250; // Conservative default
    }
}

function estimateDepartureTime(currentAltitude, currentClimbRate, aircraftCategory = undefined) {
    let avgClimbRate;
    switch (aircraftCategory) {
        case 'A1': // Light aircraft
            avgClimbRate = Math.min(currentClimbRate * 1.2, 700);
            break;
        case 'A2': // Small aircraft
            avgClimbRate = Math.min(currentClimbRate * 1.3, 1500);
            break;
        case 'A3': // Large aircraft
        case 'A4': // B757
        case 'A5': // Heavy aircraft
            avgClimbRate = Math.min(currentClimbRate * 1.5, 2500);
            break;
        case 'A7': // Rotorcraft
            avgClimbRate = Math.min(currentClimbRate * 1.1, 500);
            break;
        default:
            // Conservative estimate
            avgClimbRate = currentClimbRate * 1.3;
    }

    const minutesSinceDeparture = currentAltitude / avgClimbRate;

    return {
        departureTime: new Date(Date.now() - minutesSinceDeparture * 60 * 1000),
        minutesSinceDeparture: Number(minutesSinceDeparture.toFixed(2)),
        assumedAvgClimbRate: Number(avgClimbRate.toFixed(0)),
    };
}

function estimateCruiseAltitude(aircraftCategory, currentAltitude, climbRate) {
    const typicalCruise = {
        A1: 15000, // Light aircraft
        A2: 25000, // Small aircraft
        A3: 37000, // Large aircraft
        A4: 39000, // B757
        A5: 41000, // Heavy aircraft
        A7: 5000, // Rotorcraft
        B1: 20000, // Glider
        B4: 5000, // Ultralight
        B6: 10000, // UAV/Drone
    };
    const defaultCruise = 30000;
    const categoryCruise = typicalCruise[aircraftCategory] || defaultCruise;
    // Lower climb rates might indicate lower planned cruise
    if (climbRate < 500 && currentAltitude > 5000) return Math.min(categoryCruise, currentAltitude + 5000);

    return categoryCruise;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLandingTrajectory(lat, lon, rad, aircraft, trajectoryData = undefined) {
    // ===== 1. Input validation and screening =====

    const observerCheck = validateCoordinates(lat, lon);
    if (!observerCheck.valid) return { error: `Observer ${observerCheck.error}` };
    const radiusCheck = validateNumber(rad, 0, 1000, 'radius');
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
    const aircraftCheck = validateCoordinates(aircraft.lat, aircraft.lon);
    if (!aircraftCheck.valid) return { error: `Aircraft ${aircraftCheck.error}` };
    const trackCheck = validateNumber(aircraft.track, 0, 360, 'track');
    if (!trackCheck.valid) return { error: trackCheck.error };
    const speedCheck = validateNumber(aircraft.gs, 0, 1000, 'ground speed');
    if (!speedCheck.valid) return { error: speedCheck.error };
    const altCheck = validateNumber(aircraft.calculated.altitude, 0, 60000, 'altitude');
    if (!altCheck.valid) return { error: altCheck.error };
    if (aircraft.calculated.altitude === 0) return { error: 'Aircraft already on ground' };
    const minDescentRate = getMinDescentRate(aircraft);
    if (aircraft.baro_rate > minDescentRate) return { error: `Not descending fast enough: ${aircraft.baro_rate} > ${minDescentRate} ft/min` };

    // ===== 2. Core calculations =====

    const descentRate = Math.abs(aircraft.baro_rate); // ft/min
    const timeToGroundMinutes = aircraft.calculated.altitude / descentRate;
    const timeToGroundSeconds = Math.round(timeToGroundMinutes * 60);
    const groundSpeedKmMin = knotsToKmPerMin(aircraft.gs);
    const distanceToTravel = groundSpeedKmMin * timeToGroundMinutes;
    const projectedPosition = projectPosition(aircraft.lat, aircraft.lon, distanceToTravel, aircraft.track);
    const groundDistance = calculateDistance(lat, lon, projectedPosition.lat, projectedPosition.lon);
    if (groundDistance > rad)
        return { error: `Projected landing point ${groundDistance.toFixed(1)}km exceeds radius ${rad}km`, groundDistance, projectedPosition };
    const groundTime = new Date(Date.now() + timeToGroundSeconds * 1000);
    const groundPosition = calculateRelativePosition(lat, lon, projectedPosition.lat, projectedPosition.lon, aircraft.track);

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
    for (let i = 1; i < recentPositions.length; i++)
        bearings.push(calculateBearing(recentPositions[i - 1].lat, recentPositions[i - 1].lon, recentPositions[i].lat, recentPositions[i].lon));
    const avgBearing = bearings.reduce((a, b) => a + b, 0) / bearings.length;
    const bearingVariance =
        bearings.reduce((sum, b) => {
            const diff = Math.abs(b - avgBearing);
            return sum + (diff > 180 ? 360 - diff : diff) ** 2;
        }, 0) / bearings.length;
    const isTurning = bearingVariance > 100; // threshold in degrees²
    const descentRates = trajectoryData.descentRates || [];
    const avgDescentRate = descentRates.reduce((a, b) => a + b, 0) / descentRates.length;
    const descentVariance = descentRates.reduce((sum, r) => sum + Math.pow(r - avgDescentRate, 2), 0) / descentRates.length;
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

    const observerCheck = validateCoordinates(lat, lon);
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
    const aircraftCheck = validateCoordinates(aircraft.lat, aircraft.lon);
    if (!aircraftCheck.valid) return { error: `Aircraft ${aircraftCheck.error}` };
    const validations = [
        validateNumber(aircraft.track, 0, 360, 'track'),
        validateNumber(aircraft.gs, 0, 1000, 'ground speed'),
        validateNumber(aircraft.calculated.altitude, 0, 50000, 'altitude'),
        validateNumber(aircraft.baro_rate, -10000, 10000, 'climb rate'),
    ];
    for (const check of validations) if (!check.valid) return { error: check.error };
    const minClimbRate = getMinClimbRate(aircraft);
    if (aircraft.baro_rate < minClimbRate)
        return {
            error: `Not climbing fast enough: ${aircraft.baro_rate} < ${minClimbRate} ft/min`,
            climbRate: aircraft.baro_rate,
            minClimbRate,
        };

    // ===== 2. Core calculations =====

    const liftingAnalysis = calculateLiftingScore(aircraft.calculated.altitude, aircraft.baro_rate, aircraft.gs);
    const scoreThreshold = 3; // Configurable threshold
    if (liftingAnalysis.score < scoreThreshold)
        return { error: `Lifting score ${liftingAnalysis.score.toFixed(2)} below threshold ${scoreThreshold}`, liftingAnalysis };
    const cruiseAltitude = estimateCruiseAltitude(aircraft.category, aircraft.calculated.altitude, aircraft.baro_rate);
    const altitudeToClimb = cruiseAltitude - aircraft.calculated.altitude;
    const timeToReachCruiseMinutes = altitudeToClimb / aircraft.baro_rate;
    const projectionMinutes = Math.min(timeToReachCruiseMinutes, 15);
    const groundSpeedKmMin = knotsToKmPerMin(aircraft.gs);
    const distanceToTravel = groundSpeedKmMin * projectionMinutes;
    const projectedPosition = projectPosition(aircraft.lat, aircraft.lon, distanceToTravel, aircraft.track);
    const relativePosition = calculateRelativePosition(lat, lon, projectedPosition.lat, projectedPosition.lon, aircraft.track);
    const departureEstimate = estimateDepartureTime(aircraft.calculated.altitude, aircraft.baro_rate, aircraft.category);

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
        const climbVariance = climbRates.reduce((sum, r) => sum + Math.pow(r - avgClimbRate, 2), 0) / climbRates.length;
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
        for (let i = 1; i < recentPositions.length; i++)
            tracks.push(calculateBearing(recentPositions[i - 1].lat, recentPositions[i - 1].lon, recentPositions[i].lat, recentPositions[i].lon));
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

    const observerCheck = validateCoordinates(lat, lon);
    if (!observerCheck.valid) return { error: `Observer ${observerCheck.error}` };
    const altCheck = validateNumber(alt, -1000, 10000, 'observer altitude (meters)');
    if (!altCheck.valid) return { error: altCheck.error };
    const required = {
        lat: aircraft.lat,
        lon: aircraft.lon,
        track: aircraft.track,
        gs: aircraft.gs,
        altitude: aircraft.calculated?.altitude,
    };
    for (const [key, value] of Object.entries(required)) if (value === undefined || value === null) return { error: `Missing required field: ${key}` };
    const aircraftCheck = validateCoordinates(aircraft.lat, aircraft.lon);
    if (!aircraftCheck.valid) return { error: `Aircraft ${aircraftCheck.error}` };
    const validations = [
        validateNumber(aircraft.track, 0, 360, 'track'),
        validateNumber(aircraft.gs, 0, 2000, 'ground speed'),
        validateNumber(aircraft.calculated.altitude, 0, 60000, 'altitude'),
    ];
    for (const check of validations) if (!check.valid) return { error: check.error };

    // ===== 2. Core calculations =====

    const stationAltitudeFeet = alt * 3.28084;
    const speedKmMin = knotsToKmPerMin(aircraft.gs);
    const crossTrackResult = calculateCrossTrackDistance(lat, lon, aircraft.lat, aircraft.lon, aircraft.track);
    if (crossTrackResult.error) return { error: crossTrackResult.error };
    const { crossTrackDistance, alongTrackDistance, isApproaching } = crossTrackResult;
    const overheadDistance = Math.abs(crossTrackDistance);
    const overheadSeconds = Math.round(Math.abs(alongTrackDistance / speedKmMin) * 60);
    const overheadTime = new Date(Date.now() + (isApproaching ? overheadSeconds : -overheadSeconds) * 1000);
    const approachBearing = normalizeDeg(aircraft.track + (crossTrackDistance >= 0 ? 90 : -90));
    let overheadAltitude = aircraft.calculated.altitude;
    if (aircraft.baro_rate && isApproaching)
        overheadAltitude = Math.max(0, Math.round(aircraft.calculated.altitude + (aircraft.baro_rate / 60) * overheadSeconds));
    const relativeAltitude = overheadAltitude - stationAltitudeFeet;
    const slantRange = calculateSlantRange(overheadDistance, relativeAltitude);
    const verticalAngle = calculateVerticalAngle(overheadDistance, relativeAltitude, lat);

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
        approachCardinal: bearing2Cardinal(approachBearing),
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
    const trackBearingDiff = normalizeDeg(bearingToObs - aircraftTrack);
    const trackBearingDiffRad = deg2rad(trackBearingDiff);
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
    for (const [key, value] of Object.entries(required))
        if (value === undefined || value === null) return { error: `Missing required field: ${key}`, closureRate: undefined, closureTime: undefined };
    const aircraftCheck = validateCoordinates(aircraft.lat, aircraft.lon);
    if (!aircraftCheck.valid) return { error: `Aircraft 1 ${aircraftCheck.error}`, closureRate: undefined, closureTime: undefined };
    const otherCheck = validateCoordinates(other.lat, other.lon);
    if (!otherCheck.valid) return { error: `Aircraft 2 ${otherCheck.error}`, closureRate: undefined, closureTime: undefined };
    const validations = [
        validateNumber(aircraft.track, 0, 360, 'aircraft 1 track'),
        validateNumber(aircraft.gs, 0, 2000, 'aircraft 1 ground speed'),
        validateNumber(other.track, 0, 360, 'aircraft 2 track'),
        validateNumber(other.gs, 0, 2000, 'aircraft 2 ground speed'),
    ];
    for (const check of validations) if (!check.valid) return { error: check.error, closureRate: undefined, closureTime: undefined };

    // ===== 2. Core calculations =====

    const velocityComponents1 = calculateVelocityComponents(aircraft.track, aircraft.gs);
    const velocityComponents2 = calculateVelocityComponents(other.track, other.gs);
    const relativeVelocity = { x: velocityComponents2.x - velocityComponents1.x, y: velocityComponents2.y - velocityComponents1.y };
    const closureRate = Math.hypot(relativeVelocity.x, relativeVelocity.y);
    const currentDistance = calculateDistance(aircraft.lat, aircraft.lon, other.lat, other.lon);
    const bearing = calculateBearing(aircraft.lat, aircraft.lon, other.lat, other.lon);
    const closureAnalysis = analyzeClosureGeometry(aircraft, other, relativeVelocity, bearing, currentDistance);
    let closureTime, closestApproach;
    if (closureAnalysis.valid && Math.abs(closureAnalysis.closureVelocity) > 0.1) {
        const timeToClosest = closureAnalysis.timeToClosestApproach;
        if (timeToClosest > 0 && timeToClosest < 600) {
            closureTime = timeToClosest;
            const closestPoint1 = projectPosition(aircraft.lat, aircraft.lon, knotsToKmPerMin(aircraft.gs) * (timeToClosest / 60), aircraft.track);
            const closestPoint2 = projectPosition(other.lat, other.lon, knotsToKmPerMin(other.gs) * (timeToClosest / 60), other.track);
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
    deg2rad,
    track2rad,
    bearing2Cardinal,
    calculateDistance,
    calculateBearing,
    calculateRelativePosition,
    calculateLandingTrajectory,
    calculateLiftingTrajectory,
    calculateClosureDetails,
    calculateOverheadTrajectory,
    //
    nmToKm,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
