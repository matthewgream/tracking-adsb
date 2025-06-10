// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// All functions return consistent object structures with error handling
// All angles in degrees, distances in km (unless specified), altitudes in feet
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const constants = {
    // Earth parameters
    EARTH_RADIUS: 6371, // km (mean radius)
    EARTH_RADIUS_EQUATORIAL: 6378.137, // km
    EARTH_RADIUS_POLAR: 6356.752, // km
    EARTH_CIRCUMFERENCE: 40075, // km at equator
    EARTH_FLATTENING: 1 / 298.257223563,

    // Unit conversion factors
    FEET_TO_METERS: 0.3048,
    METERS_TO_FEET: 3.28084,
    FEET_TO_KM: 0.0003048,
    KM_TO_FEET: 3280.84,
    NM_TO_KM: 1.852,
    KM_TO_NM: 0.539957,
    NM_TO_METERS: 1852,
    KNOTS_TO_MS: 0.514444,
    MS_TO_KNOTS: 1.94384,
    KNOTS_TO_KPH: 1.852,
    KPH_TO_KNOTS: 0.539957,

    // Angular conversions
    DEG_TO_RAD: Math.PI / 180,
    RAD_TO_DEG: 180 / Math.PI,

    // Physics
    G: 9.80665, // m/s² (standard gravity)

    // Navigation
    MAGNETIC_VARIATION_DEFAULT: 0, // degrees (will vary by location)
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Validation Functions
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Validates a numeric value within bounds
 * @param {number} value - Value to validate
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {string} name - Name of the parameter for error messages
 * @returns {Object} {valid: boolean, error?: string, value?: number}
 */
function validateNumber(value, min = -Infinity, max = Infinity, name = 'value') {
    if (value === null || value === undefined) {
        return { valid: false, error: `${name} is required` };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { valid: false, error: `${name} must be a valid number` };
    }
    if (value < min || value > max) {
        return { valid: false, error: `${name} ${value} is out of bounds [${min}, ${max}]` };
    }
    return { valid: true, value };
}

/**
 * Validates geographic coordinates
 * @param {number} lat - Latitude in degrees
 * @param {number} lon - Longitude in degrees
 * @returns {Object} {valid: boolean, error?: string, lat?: number, lon?: number}
 */
function validateCoordinates(lat, lon) {
    const latCheck = validateNumber(lat, -90, 90, 'latitude');
    if (!latCheck.valid) return latCheck;

    const lonCheck = validateNumber(lon, -180, 180, 'longitude');
    if (!lonCheck.valid) return lonCheck;

    return {
        valid: true,
        lat: latCheck.value,
        lon: normalizeLongitude(lonCheck.value),
    };
}

/**
 * Validates bearing/heading in degrees
 * @param {number} bearing - Bearing in degrees
 * @returns {Object} {valid: boolean, error?: string, bearing?: number}
 */
function validateBearing(bearing) {
    const check = validateNumber(bearing, -Infinity, Infinity, 'bearing');
    if (!check.valid) return check;

    return {
        valid: true,
        bearing: normalizeDegrees(bearing),
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Unit Conversion Functions
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// Distance conversions
function nmToKm(nm) {
    return { value: nm * constants.NM_TO_KM, unit: 'km' };
}

function kmToNm(km) {
    return { value: km * constants.KM_TO_NM, unit: 'nm' };
}

function feetToKm(feet) {
    return { value: feet * constants.FEET_TO_KM, unit: 'km' };
}

function kmToFeet(km) {
    return { value: km * constants.KM_TO_FEET, unit: 'feet' };
}

function feetToMeters(feet) {
    return { value: feet * constants.FEET_TO_METERS, unit: 'm' };
}

function metersToFeet(meters) {
    return { value: meters * constants.METERS_TO_FEET, unit: 'feet' };
}

// Speed conversions
function knotsToMs(knots) {
    return { value: knots * constants.KNOTS_TO_MS, unit: 'm/s' };
}

function msToKnots(ms) {
    return { value: ms * constants.MS_TO_KNOTS, unit: 'knots' };
}

function knotsToKph(knots) {
    return { value: knots * constants.KNOTS_TO_KPH, unit: 'kph' };
}

function kphToKnots(kph) {
    return { value: kph * constants.KPH_TO_KNOTS, unit: 'knots' };
}

function knotsToKmPerMin(knots) {
    return { value: (knots * constants.NM_TO_KM) / 60, unit: 'km/min' };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Angular Conversion and Normalization Functions
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Convert degrees to radians
 * @param {number} deg - Degrees
 * @returns {Object} {value: number, unit: 'rad', error?: string}
 */
function deg2rad(deg) {
    const validation = validateNumber(deg, -Infinity, Infinity, 'degrees');
    if (!validation.valid) {
        return { value: Number.NaN, unit: 'rad', error: validation.error };
    }
    return { value: deg * constants.DEG_TO_RAD, unit: 'rad' };
}

/**
 * Convert radians to degrees
 * @param {number} rad - Radians
 * @returns {Object} {value: number, unit: 'deg', error?: string}
 */
function rad2deg(rad) {
    const validation = validateNumber(rad, -Infinity, Infinity, 'radians');
    if (!validation.valid) {
        return { value: Number.NaN, unit: 'deg', error: validation.error };
    }
    return { value: rad * constants.RAD_TO_DEG, unit: 'deg' };
}

/**
 * Normalize degrees to 0-360 range
 * @param {number} deg - Degrees
 * @returns {number} Normalized degrees
 */
function normalizeDegrees(deg) {
    return ((deg % 360) + 360) % 360;
}

/**
 * Normalize longitude to -180 to 180 range
 * @param {number} lon - Longitude in degrees
 * @returns {number} Normalized longitude
 */
function normalizeLongitude(lon) {
    let normalized = ((lon + 180) % 360) - 180;
    if (normalized <= -180) normalized += 360;
    return normalized;
}

/**
 * Convert compass track to mathematical angle in radians
 * @param {number} track - Track in degrees (0=North, 90=East)
 * @returns {Object} {value: number, unit: 'rad', error?: string}
 */
function track2rad(track) {
    const validation = validateNumber(track, -Infinity, Infinity, 'track');
    if (!validation.valid) {
        return { value: Number.NaN, unit: 'rad', error: validation.error };
    }
    const mathAngle = (450 - normalizeDegrees(track)) % 360;
    return { value: mathAngle * constants.DEG_TO_RAD, unit: 'rad' };
}

/**
 * Convert bearing to cardinal direction
 * @param {number} bearing - Bearing in degrees
 * @returns {Object} {cardinal: string, bearing: number, error?: string}
 */
function bearingToCardinal(bearing) {
    const validation = validateBearing(bearing);
    if (!validation.valid) {
        return { cardinal: '', bearing: Number.NaN, error: validation.error };
    }

    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const normalized = normalizeDegrees(validation.bearing);
    const index = Math.round((normalized + 11.25) / 22.5) % 16;

    return {
        cardinal: directions[index],
        bearing: normalized,
        precise: normalized.toFixed(1),
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate Earth's radius at a given latitude
 * @param {number} latitude - Latitude in degrees
 * @returns {number} Earth's radius in km at that latitude
 */
function getEarthRadiusAtLatitude(latitude) {
    const lat = latitude * constants.DEG_TO_RAD;
    const a = constants.EARTH_RADIUS_EQUATORIAL;
    const b = constants.EARTH_RADIUS_POLAR;

    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    const numerator = (a * a * cosLat) ** 2 + (b * b * sinLat) ** 2;
    const denominator = (a * cosLat) ** 2 + (b * sinLat) ** 2;

    return Math.sqrt(numerator / denominator);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Great Circle Calculations
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate great circle distance between two points
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {Object} {distance: number, unit: 'km', method: 'haversine', error?: string}
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const coord1 = validateCoordinates(lat1, lon1);
    if (!coord1.valid) return { distance: Number.NaN, unit: 'km', error: coord1.error };

    const coord2 = validateCoordinates(lat2, lon2);
    if (!coord2.valid) return { distance: Number.NaN, unit: 'km', error: coord2.error };

    // Check for identical points
    if (Math.abs(coord1.lat - coord2.lat) < 1e-10 && Math.abs(coord1.lon - coord2.lon) < 1e-10) {
        return { distance: 0, unit: 'km', method: 'haversine' };
    }

    const R = getEarthRadiusAtLatitude((coord1.lat + coord2.lat) / 2);
    const lat1Rad = coord1.lat * constants.DEG_TO_RAD;
    const lat2Rad = coord2.lat * constants.DEG_TO_RAD;
    const deltaLat = (coord2.lat - coord1.lat) * constants.DEG_TO_RAD;
    const deltaLon = (coord2.lon - coord1.lon) * constants.DEG_TO_RAD;

    const sinDeltaLat = Math.sin(deltaLat / 2);
    const sinDeltaLon = Math.sin(deltaLon / 2);
    const a = sinDeltaLat * sinDeltaLat + Math.cos(lat1Rad) * Math.cos(lat2Rad) * sinDeltaLon * sinDeltaLon;

    // Ensure numerical stability
    const aClamped = Math.min(1, Math.max(0, a));
    const c = 2 * Math.atan2(Math.sqrt(aClamped), Math.sqrt(1 - aClamped));

    return {
        distance: R * c,
        unit: 'km',
        method: 'haversine',
        nm: R * c * constants.KM_TO_NM,
    };
}

/**
 * Calculate initial bearing from point 1 to point 2
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {Object} {bearing: number, cardinal: string, error?: string}
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
    const coord1 = validateCoordinates(lat1, lon1);
    if (!coord1.valid) return { bearing: Number.NaN, cardinal: '', error: coord1.error };

    const coord2 = validateCoordinates(lat2, lon2);
    if (!coord2.valid) return { bearing: Number.NaN, cardinal: '', error: coord2.error };

    const lat1Rad = coord1.lat * constants.DEG_TO_RAD;
    const lat2Rad = coord2.lat * constants.DEG_TO_RAD;
    const deltaLon = (coord2.lon - coord1.lon) * constants.DEG_TO_RAD;

    const y = Math.sin(deltaLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLon);

    const bearing = Math.atan2(y, x) * constants.RAD_TO_DEG;
    const normalized = normalizeDegrees(bearing);

    return {
        bearing: normalized,
        cardinal: bearingToCardinal(normalized).cardinal,
        precise: normalized.toFixed(1),
    };
}

/**
 * Calculate relative position from reference point to target
 * @param {number} refLat - Reference latitude in degrees
 * @param {number} refLon - Reference longitude in degrees
 * @param {number} targetLat - Target latitude in degrees
 * @param {number} targetLon - Target longitude in degrees
 * @param {number} track - Optional track/heading of target in degrees
 * @returns {Object} Complete relative position information
 */
function calculateRelativePosition(refLat, refLon, targetLat, targetLon, track = undefined) {
    const distanceResult = calculateDistance(refLat, refLon, targetLat, targetLon);
    if (distanceResult.error) {
        return { error: distanceResult.error };
    }

    const bearingResult = calculateBearing(refLat, refLon, targetLat, targetLon);
    if (bearingResult.error) {
        return { error: bearingResult.error };
    }

    const result = {
        distance: distanceResult.distance,
        distanceNm: distanceResult.nm,
        bearing: bearingResult.bearing,
        cardinal: bearingResult.cardinal,
        precise: bearingResult.precise,
    };

    if (track !== undefined) {
        const trackValidation = validateBearing(track);
        if (trackValidation.valid) {
            const relativeTrack = ((trackValidation.bearing - bearingResult.bearing + 180) % 360) - 180;
            result.relativeTrack = relativeTrack;
            result.approachingStation = Math.abs(relativeTrack) < 90;
            result.closureAngle = Math.abs(relativeTrack);
        }
    }

    return result;
}

/**
 * Project a position given distance and bearing
 * @param {number} lat - Starting latitude in degrees
 * @param {number} lon - Starting longitude in degrees
 * @param {number} distanceKm - Distance to project in kilometers
 * @param {number} bearingDeg - Bearing in degrees
 * @returns {Object} {lat: number, lon: number, error?: string}
 */
function calculateProjectedPosition(lat, lon, distanceKm, bearingDeg) {
    const coord = validateCoordinates(lat, lon);
    if (!coord.valid) return { lat: Number.NaN, lon: Number.NaN, error: coord.error };

    const distValidation = validateNumber(distanceKm, 0, 20000, 'distance');
    if (!distValidation.valid) return { lat: Number.NaN, lon: Number.NaN, error: distValidation.error };

    const bearingValidation = validateBearing(bearingDeg);
    if (!bearingValidation.valid) return { lat: Number.NaN, lon: Number.NaN, error: bearingValidation.error };

    const R = getEarthRadiusAtLatitude(coord.lat);
    const latRad = coord.lat * constants.DEG_TO_RAD;
    const lonRad = coord.lon * constants.DEG_TO_RAD;
    const bearingRad = bearingValidation.bearing * constants.DEG_TO_RAD;
    const angularDistance = distanceKm / R;

    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const cosAngDist = Math.cos(angularDistance);
    const sinAngDist = Math.sin(angularDistance);

    const latRadNew = Math.asin(sinLat * cosAngDist + cosLat * sinAngDist * Math.cos(bearingRad));
    const lonRadNew = lonRad + Math.atan2(Math.sin(bearingRad) * sinAngDist * cosLat, cosAngDist - sinLat * Math.sin(latRadNew));

    const latNew = latRadNew * constants.RAD_TO_DEG;
    const lonNew = lonRadNew * constants.RAD_TO_DEG;

    return {
        lat: Math.max(-90, Math.min(90, latNew)),
        lon: normalizeLongitude(lonNew),
        method: 'greatCircle',
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Rhumb Line Calculations
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate rhumb line distance between two points
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {Object} {distance: number, unit: 'km', method: 'rhumb', error?: string}
 */
function calculateRhumbDistance(lat1, lon1, lat2, lon2) {
    const coord1 = validateCoordinates(lat1, lon1);
    if (!coord1.valid) return { distance: Number.NaN, unit: 'km', error: coord1.error };

    const coord2 = validateCoordinates(lat2, lon2);
    if (!coord2.valid) return { distance: Number.NaN, unit: 'km', error: coord2.error };

    const R = getEarthRadiusAtLatitude((coord1.lat + coord2.lat) / 2);
    const lat1Rad = coord1.lat * constants.DEG_TO_RAD;
    const lat2Rad = coord2.lat * constants.DEG_TO_RAD;
    const deltaLat = lat2Rad - lat1Rad;
    let deltaLon = (coord2.lon - coord1.lon) * constants.DEG_TO_RAD;

    // Normalize deltaLon to -π to π
    if (Math.abs(deltaLon) > Math.PI) {
        deltaLon = deltaLon > 0 ? deltaLon - 2 * Math.PI : deltaLon + 2 * Math.PI;
    }

    const deltaPsi = Math.log(Math.tan(lat2Rad / 2 + Math.PI / 4) / Math.tan(lat1Rad / 2 + Math.PI / 4));

    const q = Math.abs(deltaPsi) > 1e-10 ? deltaLat / deltaPsi : Math.cos(lat1Rad);

    const distance = R * Math.sqrt(deltaLat * deltaLat + q * q * deltaLon * deltaLon);

    return {
        distance,
        unit: 'km',
        method: 'rhumb',
        nm: distance * constants.KM_TO_NM,
    };
}

/**
 * Calculate rhumb line bearing between two points
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {Object} {bearing: number, cardinal: string, error?: string}
 */
function calculateRhumbBearing(lat1, lon1, lat2, lon2) {
    const coord1 = validateCoordinates(lat1, lon1);
    if (!coord1.valid) return { bearing: Number.NaN, cardinal: '', error: coord1.error };

    const coord2 = validateCoordinates(lat2, lon2);
    if (!coord2.valid) return { bearing: Number.NaN, cardinal: '', error: coord2.error };

    const lat1Rad = coord1.lat * constants.DEG_TO_RAD;
    const lat2Rad = coord2.lat * constants.DEG_TO_RAD;
    let deltaLon = (coord2.lon - coord1.lon) * constants.DEG_TO_RAD;

    // Normalize deltaLon to -π to π
    if (Math.abs(deltaLon) > Math.PI) {
        deltaLon = deltaLon > 0 ? deltaLon - 2 * Math.PI : deltaLon + 2 * Math.PI;
    }

    const deltaPsi = Math.log(Math.tan(lat2Rad / 2 + Math.PI / 4) / Math.tan(lat1Rad / 2 + Math.PI / 4));

    const bearing = Math.atan2(deltaLon, deltaPsi) * constants.RAD_TO_DEG;
    const normalized = normalizeDegrees(bearing);

    return {
        bearing: normalized,
        cardinal: bearingToCardinal(normalized).cardinal,
        precise: normalized.toFixed(1),
        method: 'rhumb',
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Cross Track and Along Track Calculations
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate cross track distance from a point to a great circle path
 * @param {number} pointLat - Latitude of the point
 * @param {number} pointLon - Longitude of the point
 * @param {number} pathLat1 - Latitude of path start
 * @param {number} pathLon1 - Longitude of path start
 * @param {number} pathLat2 - Latitude of path end
 * @param {number} pathLon2 - Longitude of path end
 * @returns {Object} {crossTrack: number, alongTrack: number, unit: 'km', error?: string}
 */
function calculateCrossTrackDistance(pointLat, pointLon, pathLat1, pathLon1, pathLat2, pathLon2) {
    const point = validateCoordinates(pointLat, pointLon);
    if (!point.valid) return { crossTrack: Number.NaN, alongTrack: Number.NaN, error: point.error };

    const path1 = validateCoordinates(pathLat1, pathLon1);
    if (!path1.valid) return { crossTrack: Number.NaN, alongTrack: Number.NaN, error: path1.error };

    const path2 = validateCoordinates(pathLat2, pathLon2);
    if (!path2.valid) return { crossTrack: Number.NaN, alongTrack: Number.NaN, error: path2.error };

    const R = getEarthRadiusAtLatitude((path1.lat + path2.lat + point.lat) / 3);

    // Calculate distances
    const dist13Result = calculateDistance(pathLat1, pathLon1, pointLat, pointLon);
    const bearing13Result = calculateBearing(pathLat1, pathLon1, pointLat, pointLon);
    const bearing12Result = calculateBearing(pathLat1, pathLon1, pathLat2, pathLon2);

    if (dist13Result.error || bearing13Result.error || bearing12Result.error) {
        return { crossTrack: Number.NaN, alongTrack: Number.NaN, error: 'Calculation error' };
    }

    const dist13 = dist13Result.distance / R; // Angular distance
    const bearing13Rad = bearing13Result.bearing * constants.DEG_TO_RAD;
    const bearing12Rad = bearing12Result.bearing * constants.DEG_TO_RAD;

    // Cross track distance (can be positive or negative)
    const crossTrackAngular = Math.asin(Math.sin(dist13) * Math.sin(bearing13Rad - bearing12Rad));
    const crossTrack = crossTrackAngular * R;

    // Along track distance
    const alongTrackAngular = Math.acos(Math.cos(dist13) / Math.cos(crossTrackAngular));
    const alongTrack = alongTrackAngular * R;

    return {
        crossTrack,
        alongTrack,
        unit: 'km',
        crossTrackNm: crossTrack * constants.KM_TO_NM,
        alongTrackNm: alongTrack * constants.KM_TO_NM,
        isLeftOfPath: crossTrack < 0,
        isAheadOfStart: alongTrack > 0,
    };
}

/**
 * Calculate point to point cross track for aircraft trajectory
 * @param {number} obsLat - Observer latitude
 * @param {number} obsLon - Observer longitude
 * @param {number} aircraftLat - Aircraft latitude
 * @param {number} aircraftLon - Aircraft longitude
 * @param {number} aircraftTrack - Aircraft track in degrees
 * @returns {Object} Cross track analysis
 */
function calculateAircraftCrossTrack(obsLat, obsLon, aircraftLat, aircraftLon, aircraftTrack) {
    const gcDistResult = calculateDistance(obsLat, obsLon, aircraftLat, aircraftLon);
    if (gcDistResult.error) return { error: gcDistResult.error };

    if (gcDistResult.distance < 0.001) {
        return {
            crossTrackDistance: 0,
            alongTrackDistance: 0,
            isApproaching: false,
            unit: 'km',
        };
    }

    const bearingToObsResult = calculateBearing(aircraftLat, aircraftLon, obsLat, obsLon);
    if (bearingToObsResult.error) return { error: bearingToObsResult.error };

    const trackValidation = validateBearing(aircraftTrack);
    if (!trackValidation.valid) return { error: trackValidation.error };

    const trackBearingDiff = normalizeDegrees(bearingToObsResult.bearing - trackValidation.bearing);
    const trackBearingDiffRad = trackBearingDiff * constants.DEG_TO_RAD;

    const crossTrackDistance = gcDistResult.distance * Math.sin(trackBearingDiffRad);
    const alongTrackDistance = gcDistResult.distance * Math.cos(trackBearingDiffRad);
    const isApproaching = Math.abs(trackBearingDiff) < 90;

    return {
        crossTrackDistance,
        alongTrackDistance: Math.abs(alongTrackDistance),
        isApproaching,
        unit: 'km',
        trackBearingDiff,
        willPassLeftOfStation: crossTrackDistance > 0,
        distanceToStation: gcDistResult.distance,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Vertical Angle and Slant Range Calculations
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate vertical angle from observer to target
 * @param {number} horizontalDistance - Horizontal distance in km
 * @param {number} relativeAltitude - Relative altitude in feet
 * @param {number} observerLat - Observer latitude for earth curvature correction
 * @returns {Object} {angle: number, unit: 'degrees', error?: string}
 */
function calculateVerticalAngle(horizontalDistance, relativeAltitude, observerLat) {
    const distValidation = validateNumber(horizontalDistance, 0, 1000, 'horizontal distance');
    if (!distValidation.valid) return { angle: Number.NaN, unit: 'degrees', error: distValidation.error };

    const altValidation = validateNumber(relativeAltitude, -100000, 100000, 'relative altitude');
    if (!altValidation.valid) return { angle: Number.NaN, unit: 'degrees', error: altValidation.error };

    const latValidation = validateNumber(observerLat, -90, 90, 'observer latitude');
    if (!latValidation.valid) return { angle: Number.NaN, unit: 'degrees', error: latValidation.error };

    const altitudeKm = relativeAltitude * constants.FEET_TO_KM;

    if (horizontalDistance < 0.001) {
        let angle;
        if (relativeAltitude > 0) {
            angle = 90;
        } else if (relativeAltitude < 0) {
            angle = -90;
        } else {
            angle = 0;
        }
        return {
            angle,
            unit: 'degrees',
            description: 'directly overhead',
        };
    }

    let angle = Math.atan2(altitudeKm, horizontalDistance) * constants.RAD_TO_DEG;

    // Earth curvature correction for distances > 10km
    if (horizontalDistance > 10) {
        const latRad = Math.abs(observerLat) * constants.DEG_TO_RAD;
        const cosLat = Math.max(0.001, Math.cos(latRad));
        const R = getEarthRadiusAtLatitude(Math.abs(observerLat));
        const curveCorrection = (horizontalDistance * horizontalDistance) / (2 * R * cosLat);
        const curveCorrectionAngle = Math.atan2(curveCorrection, horizontalDistance) * constants.RAD_TO_DEG;
        angle -= curveCorrectionAngle;
    }

    return {
        angle: Math.max(-90, Math.min(90, angle)),
        unit: 'degrees',
        precise: angle.toFixed(2),
        correctedForCurvature: horizontalDistance > 10,
    };
}

/**
 * Calculate slant range (direct distance) to target
 * @param {number} horizontalDistance - Horizontal distance in km
 * @param {number} relativeAltitude - Relative altitude in feet
 * @returns {Object} {range: number, unit: 'km', error?: string}
 */
function calculateSlantRange(horizontalDistance, relativeAltitude) {
    const distValidation = validateNumber(horizontalDistance, 0, 1000, 'horizontal distance');
    if (!distValidation.valid) return { range: Number.NaN, unit: 'km', error: distValidation.error };

    const altValidation = validateNumber(relativeAltitude, -100000, 100000, 'relative altitude');
    if (!altValidation.valid) return { range: Number.NaN, unit: 'km', error: altValidation.error };

    const altitudeKm = Math.abs(relativeAltitude) * constants.FEET_TO_KM;
    const range = Math.hypot(horizontalDistance, altitudeKm);

    return {
        range,
        unit: 'km',
        rangeNm: range * constants.KM_TO_NM,
        elevationAngle: calculateVerticalAngle(horizontalDistance, relativeAltitude, 0).angle,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Velocity and Closure Calculations
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate velocity components from track and ground speed
 * @param {number} track - Track in degrees (0=North, 90=East)
 * @param {number} groundSpeed - Ground speed in knots
 * @returns {Object} {x: number, y: number, magnitude: number, unit: 'knots', error?: string}
 */
function calculateVelocityComponents(track, groundSpeed) {
    const trackValidation = validateBearing(track);
    if (!trackValidation.valid) return { x: Number.NaN, y: Number.NaN, error: trackValidation.error };

    const speedValidation = validateNumber(groundSpeed, 0, 2000, 'ground speed');
    if (!speedValidation.valid) return { x: Number.NaN, y: Number.NaN, error: speedValidation.error };

    const trackRad = track2rad(trackValidation.bearing).value;

    return {
        x: speedValidation.value * Math.cos(trackRad),
        y: speedValidation.value * Math.sin(trackRad),
        magnitude: speedValidation.value,
        direction: trackValidation.bearing,
        unit: 'knots',
    };
}

/**
 * Analyze closure geometry between two moving objects
 * @param {number} track1 - Track of object 1 in degrees
 * @param {number} track2 - Track of object 2 in degrees
 * @param {Object} relativeVelocity - Relative velocity components {x, y}
 * @param {number} bearing - Bearing from object 1 to object 2
 * @param {number} distance - Current distance between objects in km
 * @returns {Object} Comprehensive closure analysis
 */
function calculateClosureGeometry(track1, track2, relativeVelocity, bearing, distance) {
    const track1Validation = validateBearing(track1);
    if (!track1Validation.valid) return { error: track1Validation.error };

    const track2Validation = validateBearing(track2);
    if (!track2Validation.valid) return { error: track2Validation.error };

    const bearingValidation = validateBearing(bearing);
    if (!bearingValidation.valid) return { error: bearingValidation.error };

    const distValidation = validateNumber(distance, 0, 1000, 'distance');
    if (!distValidation.valid) return { error: distValidation.error };

    if (!relativeVelocity || typeof relativeVelocity.x !== 'number' || typeof relativeVelocity.y !== 'number') {
        return { error: 'Invalid relative velocity' };
    }

    const bearingRad = bearingValidation.bearing * constants.DEG_TO_RAD;
    const positionVector = {
        x: distance * Math.sin(bearingRad) * 111.32, // Convert to km in x direction
        y: distance * Math.cos(bearingRad) * 111.32, // Convert to km in y direction
    };

    const relativeSpeed = Math.hypot(relativeVelocity.x, relativeVelocity.y);

    let closureVelocity = 0;
    let timeToClosestApproach;
    let minSeparation = distance;

    if (relativeSpeed > 0.001) {
        const positionMagnitude = Math.hypot(positionVector.x, positionVector.y);
        closureVelocity = -(relativeVelocity.x * positionVector.x + relativeVelocity.y * positionVector.y) / positionMagnitude;

        if (relativeSpeed > 0.1) {
            const dotProduct = positionVector.x * relativeVelocity.x + positionVector.y * relativeVelocity.y;
            const timeFactor = -dotProduct / (relativeSpeed * relativeSpeed);

            if (timeFactor > 0) {
                // Convert to seconds (velocity is in knots, position in km)
                timeToClosestApproach = (timeFactor * 3600) / constants.NM_TO_KM;

                // Calculate minimum separation
                const futurePos1X = positionVector.x + relativeVelocity.x * timeFactor;
                const futurePos1Y = positionVector.y + relativeVelocity.y * timeFactor;
                minSeparation = Math.hypot(futurePos1X, futurePos1Y) / 111.32; // Convert back to km
            }
        }
    }

    // Calculate bearing difference and aspect angles
    let bearingDiff = Math.abs(track2Validation.bearing - track1Validation.bearing);
    if (bearingDiff > 180) bearingDiff = 360 - bearingDiff;

    let aspectAngle = Math.abs(bearingValidation.bearing - track2Validation.bearing);
    if (aspectAngle > 180) aspectAngle = 360 - aspectAngle;

    return {
        valid: true,
        closureVelocity,
        closureVelocityKnots: closureVelocity,
        timeToClosestApproach,
        minSeparation,
        minSeparationNm: minSeparation * constants.KM_TO_NM,
        bearingDiff,
        aspectAngle,
        crossingAngle: bearingDiff,
        isConverging: closureVelocity < 0,
        isDiverging: closureVelocity > 0,
        isParallel: Math.abs(closureVelocity) < 1,
        relativeSpeed,
        classification: classifyEncounter(bearingDiff, aspectAngle),
    };
}

/**
 * Classify encounter type based on geometry
 * @private
 */
function classifyEncounter(bearingDiff, aspectAngle) {
    if (bearingDiff < 20) return 'overtaking';
    if (bearingDiff > 160) return 'head-on';
    if (aspectAngle < 70 || aspectAngle > 110) return 'crossing';
    return 'converging';
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Path Intersection Calculations
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate intersection of two great circle paths
 * @param {number} lat1 - Latitude of point on path 1
 * @param {number} lon1 - Longitude of point on path 1
 * @param {number} bearing1 - Bearing of path 1 in degrees
 * @param {number} lat2 - Latitude of point on path 2
 * @param {number} lon2 - Longitude of point on path 2
 * @param {number} bearing2 - Bearing of path 2 in degrees
 * @returns {Object} {intersections: Array, error?: string}
 */
function calculatePathIntersection(lat1, lon1, bearing1, lat2, lon2, bearing2) {
    const coord1 = validateCoordinates(lat1, lon1);
    if (!coord1.valid) return { intersections: [], error: coord1.error };

    const coord2 = validateCoordinates(lat2, lon2);
    if (!coord2.valid) return { intersections: [], error: coord2.error };

    const bearing1Validation = validateBearing(bearing1);
    if (!bearing1Validation.valid) return { intersections: [], error: bearing1Validation.error };

    const bearing2Validation = validateBearing(bearing2);
    if (!bearing2Validation.valid) return { intersections: [], error: bearing2Validation.error };

    // Convert to radians
    const lat1Rad = coord1.lat * constants.DEG_TO_RAD;
    const lon1Rad = coord1.lon * constants.DEG_TO_RAD;
    const lat2Rad = coord2.lat * constants.DEG_TO_RAD;
    const lon2Rad = coord2.lon * constants.DEG_TO_RAD;
    const brng1Rad = bearing1Validation.bearing * constants.DEG_TO_RAD;
    const brng2Rad = bearing2Validation.bearing * constants.DEG_TO_RAD;

    // Calculate vectors for each great circle
    const v1 = {
        x: Math.cos(lat1Rad) * Math.cos(lon1Rad),
        y: Math.cos(lat1Rad) * Math.sin(lon1Rad),
        z: Math.sin(lat1Rad),
    };

    const v2 = {
        x: Math.cos(lat2Rad) * Math.cos(lon2Rad),
        y: Math.cos(lat2Rad) * Math.sin(lon2Rad),
        z: Math.sin(lat2Rad),
    };

    // Direction vectors
    const d1 = {
        x: -Math.sin(brng1Rad) * Math.sin(lat1Rad) * Math.cos(lon1Rad) - Math.cos(brng1Rad) * Math.sin(lon1Rad),
        y: -Math.sin(brng1Rad) * Math.sin(lat1Rad) * Math.sin(lon1Rad) + Math.cos(brng1Rad) * Math.cos(lon1Rad),
        z: Math.sin(brng1Rad) * Math.cos(lat1Rad),
    };

    const d2 = {
        x: -Math.sin(brng2Rad) * Math.sin(lat2Rad) * Math.cos(lon2Rad) - Math.cos(brng2Rad) * Math.sin(lon2Rad),
        y: -Math.sin(brng2Rad) * Math.sin(lat2Rad) * Math.sin(lon2Rad) + Math.cos(brng2Rad) * Math.cos(lon2Rad),
        z: Math.sin(brng2Rad) * Math.cos(lat2Rad),
    };

    // Normal vectors to the planes
    const n1 = crossProduct(v1, d1);
    const n2 = crossProduct(v2, d2);

    // Intersection is perpendicular to both normals
    const intersection = crossProduct(n1, n2);
    const magnitude = Math.hypot(intersection.x, intersection.y, intersection.z);

    if (magnitude < 1e-10) {
        return {
            intersections: [],
            parallel: true,
            message: 'Paths are parallel or coincident',
        };
    }

    // Normalize
    intersection.x /= magnitude;
    intersection.y /= magnitude;
    intersection.z /= magnitude;

    // Convert back to lat/lon (two antipodal points)
    const intersections = [];

    const lat = Math.asin(intersection.z) * constants.RAD_TO_DEG;
    const lon = Math.atan2(intersection.y, intersection.x) * constants.RAD_TO_DEG;

    intersections.push({
        lat,
        lon: normalizeLongitude(lon),
        type: 'primary',
    });

    // Antipodal point
    intersections.push({
        lat: -lat,
        lon: normalizeLongitude(lon + 180),
        type: 'antipodal',
    });

    // Calculate distances to intersection points
    intersections.forEach((point) => {
        const dist1 = calculateDistance(lat1, lon1, point.lat, point.lon);
        const dist2 = calculateDistance(lat2, lon2, point.lat, point.lon);
        point.distanceFromPath1 = dist1.distance;
        point.distanceFromPath2 = dist2.distance;
    });

    return {
        intersections,
        parallel: false,
    };
}

/**
 * Helper function for cross product
 * @private
 */
function crossProduct(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Area Calculations
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate area of polygon on sphere
 * @param {Array} coordinates - Array of {lat, lon} points defining the polygon
 * @returns {Object} {area: number, unit: 'km²', perimeter: number, error?: string}
 */
function calculatePolygonArea(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 3) {
        return { area: Number.NaN, unit: 'km²', error: 'At least 3 coordinates required' };
    }

    // Validate all coordinates
    const validatedCoords = [];
    // eslint-disable-next-line unicorn/no-for-loop
    for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i];
        const validation = validateCoordinates(coord.lat, coord.lon);
        if (!validation.valid) {
            return { area: Number.NaN, unit: 'km²', error: `Invalid coordinate at index ${i}: ${validation.error}` };
        }
        validatedCoords.push(validation);
    }

    // Ensure polygon is closed
    const [firstPoint] = validatedCoords;
    const lastPoint = validatedCoords[validatedCoords.length - 1];
    if (firstPoint.lat !== lastPoint.lat || firstPoint.lon !== lastPoint.lon) {
        validatedCoords.push(firstPoint);
    }

    // Calculate spherical excess
    let sphericalExcess = 0;
    let perimeter = 0;

    for (let i = 0; i < validatedCoords.length - 1; i++) {
        const p1 = validatedCoords[i];
        const p2 = validatedCoords[(i + 1) % (validatedCoords.length - 1)];
        const p3 = validatedCoords[(i + 2) % (validatedCoords.length - 1)];

        // Calculate edge length for perimeter
        const edgeResult = calculateDistance(p1.lat, p1.lon, p2.lat, p2.lon);
        perimeter += edgeResult.distance;

        // Calculate angle
        const angleResult = calculateSphericalAngle(p1, p2, p3);
        if (angleResult.angle !== undefined) {
            sphericalExcess += angleResult.angle;
        }
    }

    // Subtract (n-2)*π for a polygon with n vertices
    sphericalExcess -= (validatedCoords.length - 3) * Math.PI;

    // Area = R² * spherical excess
    const R = getEarthRadiusAtLatitude(validatedCoords.reduce((sum, coord) => sum + coord.lat, 0) / validatedCoords.length);
    const area = R * R * Math.abs(sphericalExcess);

    return {
        area,
        unit: 'km²',
        perimeter,
        perimeterUnit: 'km',
        vertices: validatedCoords.length - 1,
        areaHectares: area * 100,
        areaNm2: area * constants.KM_TO_NM * constants.KM_TO_NM,
    };
}

/**
 * Calculate spherical angle at vertex p2
 * @private
 */
function calculateSphericalAngle(p1, p2, p3) {
    // Convert to radians
    const lat1 = p1.lat * constants.DEG_TO_RAD;
    const lon1 = p1.lon * constants.DEG_TO_RAD;
    const lat2 = p2.lat * constants.DEG_TO_RAD;
    const lon2 = p2.lon * constants.DEG_TO_RAD;
    const lat3 = p3.lat * constants.DEG_TO_RAD;
    const lon3 = p3.lon * constants.DEG_TO_RAD;

    // Calculate bearing from p2 to p1
    const dLon1 = lon1 - lon2;
    const y1 = Math.sin(dLon1) * Math.cos(lat1);
    const x1 = Math.cos(lat2) * Math.sin(lat1) - Math.sin(lat2) * Math.cos(lat1) * Math.cos(dLon1);
    const brng12 = Math.atan2(y1, x1);

    // Calculate bearing from p2 to p3
    const dLon3 = lon3 - lon2;
    const y3 = Math.sin(dLon3) * Math.cos(lat3);
    const x3 = Math.cos(lat2) * Math.sin(lat3) - Math.sin(lat2) * Math.cos(lat3) * Math.cos(dLon3);
    const brng23 = Math.atan2(y3, x3);

    let angle = brng23 - brng12;

    // Normalize to 0-2π
    while (angle < 0) angle += 2 * Math.PI;
    while (angle > 2 * Math.PI) angle -= 2 * Math.PI;

    return { angle };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Pattern Detection Functions (Single Trajectory)
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/* eslint-disable no-unused-vars */

/**
 * Detect circular pattern in trajectory
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} positions - Trajectory positions
 * @param {Object} options - Detection options
 * @returns {Object} {isCircular: boolean, center?: {lat, lon}, radius?: number, confidence?: number, error?: string}
 */
function detectCircularPattern(positions, options = {}) {
    return { error: 'Not implemented: detectCircularPattern' };
}

/**
 * Detect racetrack/hippodrome pattern in trajectory
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} positions - Trajectory positions
 * @param {Object} options - Detection options
 * @returns {Object} {isRacetrack: boolean, legs?: Array, turnRadius?: number, confidence?: number, error?: string}
 */
function detectRacetrackPattern(positions, options = {}) {
    return { error: 'Not implemented: detectRacetrackPattern' };
}

/**
 * Detect figure-8 pattern in trajectory
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} positions - Trajectory positions
 * @param {Object} options - Detection options
 * @returns {Object} {isFigure8: boolean, centers?: Array, crossingPoint?: {lat, lon}, confidence?: number, error?: string}
 */
function detectFigure8Pattern(positions, options = {}) {
    return { error: 'Not implemented: detectFigure8Pattern' };
}

/**
 * Detect spiral pattern in trajectory
 * @param {Array<{lat: number, lon: number, altitude?: number, timestamp?: number}>} positions - Trajectory positions
 * @param {Object} options - Detection options
 * @returns {Object} {isSpiral: boolean, direction?: string, turns?: number, confidence?: number, error?: string}
 */
function detectSpiralPattern(positions, options = {}) {
    return { error: 'Not implemented: detectSpiralPattern' };
}

/**
 * Detect zigzag pattern in trajectory
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} positions - Trajectory positions
 * @param {Object} options - Detection options
 * @returns {Object} {isZigzag: boolean, amplitude?: number, period?: number, confidence?: number, error?: string}
 */
function detectZigzagPattern(positions, options = {}) {
    return { error: 'Not implemented: detectZigzagPattern' };
}

/**
 * Detect linear pattern in trajectory
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} positions - Trajectory positions
 * @param {Object} options - Detection options
 * @returns {Object} {isLinear: boolean, bearing?: number, deviation?: number, confidence?: number, error?: string}
 */
function detectLinearPattern(positions, options = {}) {
    return { error: 'Not implemented: detectLinearPattern' };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Coordination Detection Functions (Multiple Trajectories)
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect formation pattern among multiple trajectories
 * @param {Array<Array<{lat: number, lon: number, timestamp: number}>>} trajectories - Multiple trajectories
 * @param {Object} options - Detection options
 * @returns {Object} {isFormation: boolean, type?: string, spacing?: number, confidence?: number, error?: string}
 */
function detectFormationPattern(trajectories, options = {}) {
    return { error: 'Not implemented: detectFormationPattern' };
}

/**
 * Detect parallel tracks among trajectories
 * @param {Array<Array<{lat: number, lon: number, timestamp: number}>>} trajectories - Multiple trajectories
 * @param {Object} options - Detection options
 * @returns {Object} {areParallel: boolean, averageSeparation?: number, trackDeviation?: number, error?: string}
 */
function detectParallelTracks(trajectories, options = {}) {
    return { error: 'Not implemented: detectParallelTracks' };
}

/**
 * Detect sequenced following pattern
 * @param {Array<Array<{lat: number, lon: number, timestamp: number}>>} trajectories - Multiple trajectories
 * @param {Object} options - Detection options
 * @returns {Object} {isSequenced: boolean, timeSeparation?: number, pathSimilarity?: number, error?: string}
 */
function detectSequencedFollowing(trajectories, options = {}) {
    return { error: 'Not implemented: detectSequencedFollowing' };
}

/**
 * Detect converging paths
 * @param {Array<Array<{lat: number, lon: number, timestamp: number}>>} trajectories - Multiple trajectories
 * @param {Object} options - Detection options
 * @returns {Object} {areConverging: boolean, convergencePoint?: {lat, lon}, timeToConvergence?: number, error?: string}
 */
function detectConvergingPaths(trajectories, options = {}) {
    return { error: 'Not implemented: detectConvergingPaths' };
}

/**
 * Detect diverging paths
 * @param {Array<Array<{lat: number, lon: number, timestamp: number}>>} trajectories - Multiple trajectories
 * @param {Object} options - Detection options
 * @returns {Object} {areDiverging: boolean, divergencePoint?: {lat, lon}, timeSinceDivergence?: number, error?: string}
 */
function detectDivergingPaths(trajectories, options = {}) {
    return { error: 'Not implemented: detectDivergingPaths' };
}

/**
 * Detect orbiting pattern between trajectories
 * @param {Array<Array<{lat: number, lon: number, timestamp: number}>>} trajectories - Multiple trajectories
 * @param {Object} options - Detection options
 * @returns {Object} {isOrbiting: boolean, centerTrajectory?: number, orbitRadius?: number, error?: string}
 */
function detectOrbitingPattern(trajectories, options = {}) {
    return { error: 'Not implemented: detectOrbitingPattern' };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Trajectory Analysis Functions
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate trajectory curvature at each point
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} positions - Trajectory positions
 * @param {Object} options - Calculation options
 * @returns {Object} {curvatures: Array<{position: number, curvature: number, radius: number}>, error?: string}
 */
function calculateTrajectoryCurvature(positions, options = {}) {
    return { error: 'Not implemented: calculateTrajectoryCurvature' };
}

/**
 * Calculate minimum bounding corridor for trajectory
 * @param {Array<{lat: number, lon: number}>} positions - Trajectory positions
 * @param {Object} options - Calculation options
 * @returns {Object} {width: number, centerline: Array, deviations: Array, error?: string}
 */
function calculateTrajectoryCorrdidor(positions, options = {}) {
    return { error: 'Not implemented: calculateTrajectoryCorrdidor' };
}

/**
 * Calculate similarity between two trajectories
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} trajectory1 - First trajectory
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} trajectory2 - Second trajectory
 * @param {Object} options - Calculation options
 * @returns {Object} {similarity: number, frechetDistance?: number, hausdorffDistance?: number, error?: string}
 */
function calculateTrajectorySimilarity(trajectory1, trajectory2, options = {}) {
    return { error: 'Not implemented: calculateTrajectorySimilarity' };
}

/**
 * Calculate trajectory entropy (measure of randomness)
 * @param {Array<{lat: number, lon: number, timestamp: number}>} positions - Trajectory positions
 * @param {Object} options - Calculation options
 * @returns {Object} {entropy: number, predictability: number, error?: string}
 */
function calculateTrajectoryEntropy(positions, options = {}) {
    return { error: 'Not implemented: calculateTrajectoryEntropy' };
}

/**
 * Calculate trajectory complexity
 * @param {Array<{lat: number, lon: number}>} positions - Trajectory positions
 * @param {Object} options - Calculation options
 * @returns {Object} {complexity: number, factors: Object, error?: string}
 */
function calculateTrajectoryComplexity(positions, options = {}) {
    return { error: 'Not implemented: calculateTrajectoryComplexity' };
}

/**
 * Calculate trajectory symmetry
 * @param {Array<{lat: number, lon: number}>} positions - Trajectory positions
 * @param {Object} options - Calculation options
 * @returns {Object} {symmetry: number, axis?: {angle: number}, error?: string}
 */
function calculateTrajectorySymmetry(positions, options = {}) {
    return { error: 'Not implemented: calculateTrajectorySymmetry' };
}

/**
 * Calculate trajectory periodicity
 * @param {Array<{lat: number, lon: number, timestamp: number}>} positions - Trajectory positions
 * @param {Object} options - Calculation options
 * @returns {Object} {isPeriodic: boolean, period?: number, confidence?: number, error?: string}
 */
function calculateTrajectoryPeriodicity(positions, options = {}) {
    return { error: 'Not implemented: calculateTrajectoryPeriodicity' };
}

/**
 * Calculate velocity profile along trajectory
 * @param {Array<{lat: number, lon: number, timestamp: number}>} positions - Trajectory positions
 * @param {Object} options - Calculation options
 * @returns {Object} {velocities: Array<{time: number, speed: number, acceleration: number}>, error?: string}
 */
function calculateTrajectoryVelocityProfile(positions, options = {}) {
    return { error: 'Not implemented: calculateTrajectoryVelocityProfile' };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Trajectory Transformation Functions
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Simplify trajectory using Douglas-Peucker algorithm
 * @param {Array<{lat: number, lon: number}>} positions - Trajectory positions
 * @param {number} tolerance - Simplification tolerance in km
 * @returns {Object} {simplified: Array, removedPoints: number, error?: string}
 */
function simplifyTrajectory(positions, tolerance) {
    return { error: 'Not implemented: simplifyTrajectory' };
}

/**
 * Smooth trajectory using moving average
 * @param {Array<{lat: number, lon: number, timestamp?: number}>} positions - Trajectory positions
 * @param {number} windowSize - Smoothing window size
 * @returns {Object} {smoothed: Array, error?: string}
 */
function smoothTrajectory(positions, windowSize) {
    return { error: 'Not implemented: smoothTrajectory' };
}

/**
 * Interpolate trajectory to fixed time intervals
 * @param {Array<{lat: number, lon: number, timestamp: number}>} positions - Trajectory positions
 * @param {number} intervalSeconds - Desired interval in seconds
 * @returns {Object} {interpolated: Array, error?: string}
 */
function interpolateTrajectory(positions, intervalSeconds) {
    return { error: 'Not implemented: interpolateTrajectory' };
}

/**
 * Resample trajectory to fixed number of points
 * @param {Array<{lat: number, lon: number}>} positions - Trajectory positions
 * @param {number} numberOfPoints - Desired number of points
 * @returns {Object} {resampled: Array, error?: string}
 */
function resampleTrajectory(positions, numberOfPoints) {
    return { error: 'Not implemented: resampleTrajectory' };
}

/**
 * Align two trajectories spatially
 * @param {Array<{lat: number, lon: number}>} trajectory1 - First trajectory
 * @param {Array<{lat: number, lon: number}>} trajectory2 - Second trajectory
 * @param {Object} options - Alignment options
 * @returns {Object} {aligned1: Array, aligned2: Array, transformation: Object, error?: string}
 */
function alignTrajectories(trajectory1, trajectory2, options = {}) {
    return { error: 'Not implemented: alignTrajectories' };
}

/**
 * Synchronize multiple trajectories temporally
 * @param {Array<Array<{lat: number, lon: number, timestamp: number}>>} trajectories - Multiple trajectories
 * @param {Object} options - Synchronization options
 * @returns {Object} {synchronized: Array, commonTimebase: Array, error?: string}
 */
function synchronizeTrajectories(trajectories, options = {}) {
    return { error: 'Not implemented: synchronizeTrajectories' };
}

/**
 * Rotate trajectory around a center point
 * @param {Array<{lat: number, lon: number}>} positions - Trajectory positions
 * @param {number} angle - Rotation angle in degrees
 * @param {Object} centerPoint - Center of rotation {lat, lon}
 * @returns {Object} {rotated: Array, error?: string}
 */
function rotateTrajectory(positions, angle, centerPoint) {
    return { error: 'Not implemented: rotateTrajectory' };
}

/**
 * Scale trajectory relative to a center point
 * @param {Array<{lat: number, lon: number}>} positions - Trajectory positions
 * @param {number} scaleFactor - Scale factor (1.0 = no change)
 * @param {Object} centerPoint - Center of scaling {lat, lon}
 * @returns {Object} {scaled: Array, error?: string}
 */
function scaleTrajectory(positions, scaleFactor, centerPoint) {
    return { error: 'Not implemented: scaleTrajectory' };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Geometric Primitive Functions
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate convex hull of positions
 * @param {Array<{lat: number, lon: number}>} positions - Set of positions
 * @returns {Object} {hull: Array, area: number, perimeter: number, error?: string}
 */
function calculateConvexHull(positions) {
    return { error: 'Not implemented: calculateConvexHull' };
}

/**
 * Calculate centroid of positions
 * @param {Array<{lat: number, lon: number}>} positions - Set of positions
 * @returns {Object} {centroid: {lat: number, lon: number}, error?: string}
 */
function calculateCentroid(positions) {
    return { error: 'Not implemented: calculateCentroid' };
}

/**
 * Calculate bounding box of positions
 * @param {Array<{lat: number, lon: number}>} positions - Set of positions
 * @returns {Object} {north: number, south: number, east: number, west: number, error?: string}
 */
function calculateBoundingBox(positions) {
    return { error: 'Not implemented: calculateBoundingBox' };
}

/**
 * Fit circle to set of points
 * @param {Array<{lat: number, lon: number}>} positions - Set of positions
 * @returns {Object} {center: {lat: number, lon: number}, radius: number, residual: number, error?: string}
 */
function fitCircleToPoints(positions) {
    return { error: 'Not implemented: fitCircleToPoints' };
}

/**
 * Fit line to set of points
 * @param {Array<{lat: number, lon: number}>} positions - Set of positions
 * @returns {Object} {start: {lat, lon}, end: {lat, lon}, bearing: number, residual: number, error?: string}
 */
function fitLineToPoints(positions) {
    return { error: 'Not implemented: fitLineToPoints' };
}

/**
 * Fit ellipse to set of points
 * @param {Array<{lat: number, lon: number}>} positions - Set of positions
 * @returns {Object} {center: {lat, lon}, semiMajor: number, semiMinor: number, rotation: number, error?: string}
 */
function fitEllipseToPoints(positions) {
    return { error: 'Not implemented: fitEllipseToPoints' };
}

/**
 * Calculate point density
 * @param {Array<{lat: number, lon: number}>} positions - Set of positions
 * @param {number} radius - Radius in km for density calculation
 * @returns {Object} {densityMap: Array<{position: {lat, lon}, density: number}>, error?: string}
 */
function calculatePointDensity(positions, radius) {
    return { error: 'Not implemented: calculatePointDensity' };
}

/* eslint-enable no-unused-vars */

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Module Exports
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    // Constants
    constants,

    // Validation
    validateNumber,
    validateCoordinates,
    validateBearing,

    // Unit Conversions
    nmToKm,
    kmToNm,
    feetToKm,
    kmToFeet,
    feetToMeters,
    metersToFeet,
    knotsToMs,
    msToKnots,
    knotsToKph,
    kphToKnots,
    knotsToKmPerMin,

    // Angular Operations
    deg2rad,
    rad2deg,
    normalizeDegrees,
    normalizeLongitude,
    track2rad,
    bearingToCardinal,

    //
    getEarthRadiusAtLatitude,

    // Great Circle Calculations
    calculateDistance,
    calculateBearing,
    calculateRelativePosition,
    calculateProjectedPosition,

    // Rhumb Line Calculations
    calculateRhumbDistance,
    calculateRhumbBearing,

    // Cross Track Calculations
    calculateCrossTrackDistance,
    calculateAircraftCrossTrack,

    // Vertical Calculations
    calculateVerticalAngle,
    calculateSlantRange,

    // Velocity and Closure
    calculateVelocityComponents,
    calculateClosureGeometry,

    // Path Operations
    calculatePathIntersection,

    // Area Calculations
    calculatePolygonArea,

    // not implemented yet: Pattern Detection (Single Trajectory)
    detectCircularPattern,
    detectRacetrackPattern,
    detectFigure8Pattern,
    detectSpiralPattern,
    detectZigzagPattern,
    detectLinearPattern,

    // not implemented yet: Coordination Detection (Multiple Trajectories)
    detectFormationPattern,
    detectParallelTracks,
    detectSequencedFollowing,
    detectConvergingPaths,
    detectDivergingPaths,
    detectOrbitingPattern,

    // not implemented yet: Trajectory Analysis
    calculateTrajectoryCurvature,
    calculateTrajectoryCorrdidor,
    calculateTrajectorySimilarity,
    calculateTrajectoryEntropy,
    calculateTrajectoryComplexity,
    calculateTrajectorySymmetry,
    calculateTrajectoryPeriodicity,
    calculateTrajectoryVelocityProfile,

    // not implemented yet: Trajectory Transformations
    simplifyTrajectory,
    smoothTrajectory,
    interpolateTrajectory,
    resampleTrajectory,
    alignTrajectories,
    synchronizeTrajectories,
    rotateTrajectory,
    scaleTrajectory,

    // not implemented yet: Geometric Primitives
    calculateConvexHull,
    calculateCentroid,
    calculateBoundingBox,
    fitCircleToPoints,
    fitLineToPoints,
    fitEllipseToPoints,
    calculatePointDensity,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
