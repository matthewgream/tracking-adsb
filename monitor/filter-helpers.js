// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function track2rad(track) {
    return deg2rad((450 - track) % 360);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1),
        dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const lat1Rad = (Math.PI * lat1) / 180,
        lat2Rad = (Math.PI * lat2) / 180;
    const lon1Rad = (Math.PI * lon1) / 180,
        lon2Rad = (Math.PI * lon2) / 180;
    const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad),
        x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
}

function calculateRelativePosition(refLat, refLon, targetLat, targetLon, track) {
    const distance = calculateDistance(refLat, refLon, targetLat, targetLon),
        bearing = calculateBearing(refLat, refLon, targetLat, targetLon);
    const relativeTrack = ((track - bearing + 180) % 360) - 180;
    return {
        distance,
        bearing,
        relativeTrack,
        cardinalBearing: bearing2Cardinal(bearing),
        approachingStation: Math.abs(relativeTrack) < 90,
    };
}

function calculateVerticalAngle(horizontalDistance, relativeAltitude, observerLat) {
    const altitudeKm = relativeAltitude * 0.0003048; // feet to km
    if (horizontalDistance < 0.001) return relativeAltitude > 0 ? 90 : -90; // Directly overhead or below
    let angle = Math.atan2(altitudeKm, horizontalDistance) * (180 / Math.PI);
    if (horizontalDistance > 10) {
        // Only apply for distances > 10km
        const latRad = Math.abs((observerLat * Math.PI) / 180);
        const curveCorrection = horizontalDistance ** 2 / (12800 * Math.cos(latRad));
        angle += Math.atan2(curveCorrection, horizontalDistance) * (180 / Math.PI);
    }
    return Math.max(-90, Math.min(90, angle));
}

function calculateSlantRange(horizontalDistance, relativeAltitude) {
    const altitudeKm = relativeAltitude * 0.0003048; // feet to km
    return Math.hypot(horizontalDistance ** 2 + altitudeKm ** 2);
}

function bearing2Cardinal(bearing) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[Math.round(bearing / 22.5) % 16];
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

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLandingTrajectory(lat, lon, rad, aircraft) {
    if (aircraft.lat === undefined || aircraft.lon === undefined || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude || !aircraft.baro_rate)
        return undefined;
    if (aircraft.calculated.altitude === 0 || aircraft.calculated.altitude === 'ground') return undefined;
    const minDescentRate = getMinDescentRate(aircraft);
    if (aircraft.baro_rate > minDescentRate) return undefined;
    const descentRate = Math.abs(aircraft.baro_rate);
    const timeToGround = aircraft.calculated.altitude / descentRate,
        groundSeconds = Math.round(timeToGround * 60);
    const groundSpeedKmMin = (aircraft.gs * 1.852) / 60;
    const distanceTraveled = groundSpeedKmMin * timeToGround; // km
    const trackRad = track2rad(aircraft.track);
    const dx = distanceTraveled * Math.cos(trackRad),
        dy = distanceTraveled * Math.sin(trackRad);
    const latPerKm = 1 / 111.32,
        lonPerKm = 1 / (111.32 * Math.cos(deg2rad(aircraft.lat))); // degrees per km, adjusted
    const groundLat = aircraft.lat + dy * latPerKm,
        groundLon = aircraft.lon + dx * lonPerKm;
    const groundDistance = calculateDistance(lat, lon, groundLat, groundLon);
    if (groundDistance > rad) return undefined;
    const groundTime = new Date(Date.now() + groundSeconds * 1000);
    const groundPosition = calculateRelativePosition(lat, lon, groundLat, groundLon, aircraft.track);

    return {
        isLanding: true,
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

function calculateLiftingTrajectory(lat, lon, aircraft) {
    if (aircraft.lat === undefined || aircraft.lon === undefined || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude || !aircraft.baro_rate)
        return undefined;
    const minClimbRate = getMinClimbRate(aircraft);
    if (aircraft.baro_rate < minClimbRate) return undefined;
    const climbIndicator = aircraft.calculated.altitude < 3000 ? 2 : 1; // Weight lower altitudes more heavily
    const liftingScore = ((climbIndicator * aircraft.baro_rate) / 100) * (1 - Math.min(1, aircraft.calculated.altitude / 10000));
    if (liftingScore < 3) return undefined; // Adjust threshold as needed
    const ascendRate = aircraft.baro_rate;
    const timeToReachCruise = (30000 - aircraft.calculated.altitude) / ascendRate; // Time to reach 30,000 ft
    const climbMinutes = Math.min(timeToReachCruise, 15) / 60; // Cap at 15 minutes
    const groundSpeedKmMin = (aircraft.gs * 1.852) / 60; // Convert to km/min
    const distanceTraveled = groundSpeedKmMin * climbMinutes; // km
    const trackRad = track2rad(aircraft.track);
    const dx = distanceTraveled * Math.cos(trackRad);
    const dy = distanceTraveled * Math.sin(trackRad);
    const latPerKm = 1 / 111.32;
    const lonPerKm = 1 / (111.32 * Math.cos(deg2rad(aircraft.lat))); // Adjusted for latitude
    const projectedLat = aircraft.lat + dy * latPerKm;
    const projectedLon = aircraft.lon + dx * lonPerKm;
    const projectedPosition = calculateRelativePosition(lat, lon, projectedLat, projectedLon, aircraft.track);

    return {
        isLifting: true,
        departureAltitude: aircraft.calculated.altitude,
        climbRate: aircraft.baro_rate,
        liftingScore,
        projectedLat: Number(projectedLat.toFixed(6)),
        projectedLon: Number(projectedLon.toFixed(6)),
        projectedPosition,
        departureTime: new Date(Date.now() - (aircraft.calculated.altitude / aircraft.baro_rate) * 60 * 1000), // Estimate time of departure
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateOverheadTrajectory(lat, lon, alt, aircraft) {
    if (aircraft.lat === undefined || aircraft.lon === undefined || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude) return undefined;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || Math.abs(aircraft.lat) > 90 || Math.abs(aircraft.lon) > 180) return undefined;
    if (aircraft.gs <= 0 || aircraft.gs > 2000) return undefined;
    const earthRadius = 6371;
    const stationLatRad = deg2rad(lat),
        stationLonRad = deg2rad(lon);
    const aircraftLatRad = deg2rad(aircraft.lat),
        aircraftLonRad = deg2rad(aircraft.lon);
    const trackRad = track2rad(aircraft.track);
    const speed = (aircraft.gs * 1.852) / 60; // Convert knots to km/min
    const cosValue =
        Math.sin(aircraftLatRad) * Math.sin(stationLatRad) + Math.cos(aircraftLatRad) * Math.cos(stationLatRad) * Math.cos(aircraftLonRad - stationLonRad);
    const clampedCosValue = Math.max(-1, Math.min(1, cosValue)); // Clamp to [-1, 1]
    const initialDistance = earthRadius * Math.acos(clampedCosValue);
    const y = Math.sin(stationLonRad - aircraftLonRad) * Math.cos(stationLatRad),
        x = Math.cos(aircraftLatRad) * Math.sin(stationLatRad) - Math.sin(aircraftLatRad) * Math.cos(stationLatRad) * Math.cos(stationLonRad - aircraftLonRad);
    const angleDiff = trackRad - Math.atan2(y, x);
    const sinValue = Math.sin(initialDistance / earthRadius) * Math.sin(angleDiff);
    const clampedSinValue = Math.max(-1, Math.min(1, sinValue)); // Clamp to [-1, 1]
    const crossTrackDistance = Math.asin(clampedSinValue) * earthRadius;
    const cosValue2 = Math.cos(initialDistance / earthRadius) / Math.cos(crossTrackDistance / earthRadius);
    const clampedCosValue2 = Math.max(-1, Math.min(1, cosValue2)); // Clamp to [-1, 1]
    const alongTrackDistance = Math.acos(clampedCosValue2) * earthRadius;
    //
    const overheadFuture = Math.cos(angleDiff) >= 0;
    const overheadDistance = Math.abs(crossTrackDistance);
    const overheadSeconds = Math.round((alongTrackDistance / speed) * 60);
    const overheadTime = new Date(Date.now() + (overheadFuture ? overheadSeconds : -overheadSeconds) * 1000);
    const approachBearing = (aircraft.track + 90) % 360;
    const stationAltitude = alt * 3.28084; // Convert meters to feet
    const overheadAltitude =
        aircraft.baro_rate && overheadFuture
            ? Math.max(0, Math.round(aircraft.calculated.altitude + (aircraft.baro_rate / 60) * overheadSeconds))
            : aircraft.calculated.altitude;
    const relativeAltitude = overheadAltitude - stationAltitude;
    const slantRange = calculateSlantRange(overheadDistance, relativeAltitude);
    const verticalAngle = calculateVerticalAngle(overheadDistance, relativeAltitude, lat);

    return {
        willIntersectOverhead: true,
        overheadFuture,
        overheadDistance,
        overheadSeconds,
        overheadTime,
        overheadAltitude, // Absolute altitude (feet MSL)
        relativeAltitude, // Altitude above observer (feet AGL)
        stationAltitude, // Observer altitude (feet MSL)
        slantRange, // Actual distance to aircraft at overhead point (km)
        verticalRate: aircraft.baro_rate, // feet per minute (can be positive, negative, or null)
        approachBearing,
        approachCardinal: bearing2Cardinal(approachBearing),
        verticalAngle, // Angle to look up in the sky (degrees)
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateClosureDetails(aircraft, otherAircraft) {
    let closureRate, closureTime;
    if (aircraft.track && aircraft.gs && otherAircraft.track && otherAircraft.gs) {
        const track1Rad = track2rad(aircraft.track),
            track2Rad = track2rad(otherAircraft.track);
        const vx1 = aircraft.gs * Math.cos(track1Rad),
            vy1 = aircraft.gs * Math.sin(track1Rad),
            vx2 = otherAircraft.gs * Math.cos(track2Rad),
            vy2 = otherAircraft.gs * Math.sin(track2Rad);
        const relVx = vx2 - vx1,
            relVy = vy2 - vy1;
        closureRate = Math.hypot(relVx, relVy);
        const bearingRad = deg2rad(calculateBearing(aircraft.lat, aircraft.lon, otherAircraft.lat, otherAircraft.lon));
        const closureVelocity = relVx * Math.cos(bearingRad) + relVy * Math.sin(bearingRad);
        if (Math.abs(closureVelocity) > 0.1) {
            const horizontalDistance = calculateDistance(aircraft.lat, aircraft.lon, otherAircraft.lat, otherAircraft.lon);
            const timeSeconds = (horizontalDistance * 1000) / Math.abs(closureVelocity * 0.514444);
            closureTime = closureVelocity < 0 ? timeSeconds : -timeSeconds;
            if (Math.abs(closureTime) > 600) closureTime = undefined;
        }
    }

    return { closureRate, closureTime };
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
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
