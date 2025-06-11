// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// const helpers = require('./filter-helpers.js');
const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };

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
    const currentDistance = tools.calculateDistance(aircraft.lat, aircraft.lon, other.lat, other.lon).distance;
    const { bearing } = tools.calculateBearing(aircraft.lat, aircraft.lon, other.lat, other.lon);
    const closureAnalysis = tools.calculateClosureGeometry(aircraft, other, relativeVelocity, bearing, currentDistance);
    let closureTime, closestApproach;
    if (closureAnalysis.valid && Math.abs(closureAnalysis.closureVelocity) > 0.1) {
        const timeToClosest = closureAnalysis.timeToClosestApproach;
        if (timeToClosest > 0 && timeToClosest < 600) {
            closureTime = timeToClosest;
            const closestPoint1 = tools.calculateProjectedPosition(aircraft.lat, aircraft.lon, tools.knotsToKmPerMin(aircraft.gs).value * (timeToClosest / 60), aircraft.track),
                closestPoint2 = tools.calculateProjectedPosition(other.lat, other.lon, tools.knotsToKmPerMin(other.gs).value * (timeToClosest / 60), other.track);
            closestApproach = {
                distance: tools.calculateDistance(closestPoint1.lat, closestPoint1.lon, closestPoint2.lat, closestPoint2.lon).distance,
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

const DEFAULT_HORIZONTAL_THRESHOLD = 1; // NM, converted to km
const DEFAULT_VERTICAL_THRESHOLD = 1000; // feet
const DEFAULT_CLOSURE_RATE_THRESHOLD = 400; // knots - high closure rate increases severity

function calculateRiskCategory(horizontalDistance, verticalSeparation, closureRate) {
    let riskCategory;
    if (horizontalDistance < tools.nmToKm(0.25).value && verticalSeparation < 500)
        riskCategory = 'A'; // Serious risk of collision
    else if (horizontalDistance < tools.nmToKm(0.5).value && verticalSeparation < 500)
        riskCategory = 'B'; // Safety not assured
    else if (horizontalDistance < tools.nmToKm(1).value)
        riskCategory = 'C'; // No risk of collision
    else riskCategory = 'D'; // Risk not determined
    if (closureRate && closureRate > DEFAULT_CLOSURE_RATE_THRESHOLD) {
        if (riskCategory === 'C') riskCategory = 'B';
        if (riskCategory === 'B') riskCategory = 'A';
    }
    return riskCategory;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAirprox(conf, aircraft, aircraftList) {
    const horizontalThreshold = conf.horizontalThreshold || DEFAULT_HORIZONTAL_THRESHOLD,
        verticalThreshold = conf.verticalThreshold || DEFAULT_VERTICAL_THRESHOLD;
    if (aircraft.lat == undefined || aircraft.lon == undefined || !aircraft.calculated.altitude) return undefined;
    if (aircraft.calculated?.airports_nearby?.hasAirportsNearby) return undefined; // XXX should be only ATC controlled

    const horizontalThresholdKm = tools.nmToKm(horizontalThreshold).value;
    const proximateAircraft = aircraftList.filter((other) => {
        if (other.calculated.airprox) return false;
        if (other.hex === aircraft.hex) return false;
        if (other.calculated?.airports_nearby?.hasAirportsNearby) return false;
        if (other.lat === undefined || other.lon === undefined || !other.calculated?.altitude) return false;

        const horizontalDistance = tools.calculateDistance(aircraft.lat, aircraft.lon, other.lat, other.lon).distance;
        if (horizontalDistance > horizontalThresholdKm) return false;
        const verticalSeparation = Math.abs(aircraft.calculated.altitude - other.calculated.altitude);
        if (verticalSeparation > verticalThreshold) return false;
        return true;
    });
    if (proximateAircraft.length === 0) return undefined;

    const [otherAircraft] = proximateAircraft.sort((a, b) => tools.calculateDistance(aircraft.lat, aircraft.lon, a.lat, a.lon).distance - tools.calculateDistance(aircraft.lat, aircraft.lon, b.lat, b.lon).distance);
    const horizontalDistance = tools.calculateDistance(aircraft.lat, aircraft.lon, otherAircraft.lat, otherAircraft.lon).distance;
    const verticalSeparation = Math.abs(aircraft.calculated.altitude - otherAircraft.calculated.altitude);
    const { closureRate, closureTime } = calculateClosureDetails(aircraft, otherAircraft);

    return {
        hasAirprox: true,
        otherAircraft,
        horizontalDistance, // in km
        verticalSeparation, // in feet
        closureRate, // in knots, can be null
        closureTime, // in seconds, can be null
        riskCategory: calculateRiskCategory(horizontalDistance, verticalSeparation, closureRate), // A, B, C, or D
        proximateCount: proximateAircraft.length, // How many aircraft are too close
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const categoryOrder = { A: 0, B: 1, C: 2, D: 3 };

module.exports = {
    id: 'airprox',
    name: 'Aircraft proximity warning',
    priority: 1, // High priority (same as emergency)
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft, { aircraftList }) => {
        aircraft.calculated.airprox = { hasAirprox: false };
        const airprox = detectAirprox(this.conf, aircraft, aircraftList);
        if (airprox) aircraft.calculated.airprox = airprox;
    },
    evaluate: (aircraft) => aircraft.calculated.airprox.hasAirprox,
    sort: (a, b) => {
        const a_ = a.calculated.airprox,
            b_ = b.calculated.airprox;
        if (categoryOrder[a_.riskCategory] !== categoryOrder[b_.riskCategory]) return categoryOrder[a_.riskCategory] - categoryOrder[b_.riskCategory];
        if (a_.horizontalDistance !== b_.horizontalDistance) return a_.horizontalDistance - b_.horizontalDistance;
        return a_.verticalSeparation - b_.verticalSeparation;
    },
    getStats: (aircrafts, list) => {
        const byCategory = list.map((aircraft) => aircraft.calculated.airprox.riskCategory).reduce((counts, category) => ({ ...counts, [category]: (counts[category] || 0) + 1 }), {});
        return {
            categoryA: byCategory.A || 0,
            categoryB: byCategory.B || 0,
            categoryC: byCategory.C || 0,
            categoryD: byCategory.D || 0,
            byCategory,
        };
    },
    format: (aircraft) => {
        const { airprox } = aircraft.calculated;
        const { closureTime, closureRate, riskCategory, verticalSeparation, horizontalDistance, otherAircraft } = airprox;
        let proximityDescription = `proximity alert`;
        if (closureTime !== undefined) {
            const timeToCA = Math.round(closureTime);
            proximityDescription = timeToCA > 0 ? `convergence in ~${timeToCA} seconds` : `diverging`;
        }
        return {
            text: `airprox ${riskCategory} with ${otherAircraft.flight} - ${horizontalDistance.toFixed(1)}km/${verticalSeparation}ft separation - ${proximityDescription}`,
            warn: riskCategory === 'A' || riskCategory === 'B',
            airproxInfo: {
                otherFlight: otherAircraft.flight,
                horizontalDistance,
                verticalSeparation,
                riskCategory,
                closureRate,
                closureTime,
            },
        };
    },
    debug: (type, aircraft) => {
        const { airprox } = aircraft.calculated;
        if (type == 'sorting') return `risk=${airprox.riskCategory}, dist=${airprox.horizontalDistance.toFixed(1)}km, vsep=${airprox.verticalSeparation}ft`;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
