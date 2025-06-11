// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };

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
        const { distance } = tools.calculateDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
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
    const { distance } = tools.calculateDistance(recent[0].lat, recent[0].lon, recent[1].lat, recent[1].lon);
    const { bearing } = tools.calculateBearing(recent[0].lat, recent[0].lon, recent[1].lat, recent[1].lon);
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

module.exports = {
    // unused
    willPathsIntersect,
    calculateWind,
    analyzeTurn,
    calculateEnergyState,
    predictTrajectory,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
