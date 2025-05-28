// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const DEFAULT_HORIZONTAL_THRESHOLD = 1; // NM, converted to km
const DEFAULT_VERTICAL_THRESHOLD = 1000; // feet
//const DEFAULT_AIRPORT_EXCLUSION_RADIUS = 5; // km - don't report airprox near airports
const DEFAULT_CLOSURE_RATE_THRESHOLD = 400; // knots - high closure rate increases severity

function calculateRiskCategory(horizontalDistance, verticalSeparation, closureRate) {
    let riskCategory;
    if (horizontalDistance < helpers.nmToKm(0.25) && verticalSeparation < 500)
        riskCategory = 'A'; // Serious risk of collision
    else if (horizontalDistance < helpers.nmToKm(0.5) && verticalSeparation < 500)
        riskCategory = 'B'; // Safety not assured
    else if (horizontalDistance < helpers.nmToKm(1))
        riskCategory = 'C'; // No risk of collision
    else riskCategory = 'D'; // Risk not determined
    if (closureRate && closureRate > DEFAULT_CLOSURE_RATE_THRESHOLD) {
        if (riskCategory === 'C') riskCategory = 'B';
        if (riskCategory === 'B') riskCategory = 'A';
    }
    return riskCategory;
}

function detectAirprox(aircraft, aircraftList, horizontalThreshold, verticalThreshold) {
    if (aircraft.lat == undefined || aircraft.lon == undefined || !aircraft.calculated.altitude) return undefined;
    if (aircraft.calculated?.airports_nearby?.length > 0) return undefined;

    const horizontalThresholdKm = helpers.nmToKm(horizontalThreshold);

    const proximateAircraft = aircraftList.filter((other) => {
        if (other.calculated.airprox) return false;
        if (other.hex === aircraft.hex) return false;
        if (other.calculated?.airports_nearby?.length > 0) return false;
        if (other.lat === undefined || other.lon === undefined || !other.calculated?.altitude) return false;

        const horizontalDistance = helpers.calculateDistance(aircraft.lat, aircraft.lon, other.lat, other.lon);
        if (horizontalDistance > horizontalThresholdKm) return false;
        const verticalSeparation = Math.abs(aircraft.calculated.altitude - other.calculated.altitude);
        if (verticalSeparation > verticalThreshold) return false;
        return true;
    });
    if (proximateAircraft.length === 0) return undefined;

    const [otherAircraft] = proximateAircraft.sort(
        (a, b) => helpers.calculateDistance(aircraft.lat, aircraft.lon, a.lat, a.lon) - helpers.calculateDistance(aircraft.lat, aircraft.lon, b.lat, b.lon)
    );
    const horizontalDistance = helpers.calculateDistance(aircraft.lat, aircraft.lon, otherAircraft.lat, otherAircraft.lon);
    const verticalSeparation = Math.abs(aircraft.calculated.altitude - otherAircraft.calculated.altitude);
    const { closureRate, closureTime } = helpers.calculateClosureDetails(aircraft, otherAircraft);

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
    preprocess: (aircraft, aircraftList) => {
        aircraft.calculated.airprox = { hasAirprox: false };
        const airprox = detectAirprox(
            aircraft,
            aircraftList,
            this.conf.horizontalThreshold || DEFAULT_HORIZONTAL_THRESHOLD,
            this.conf.verticalThreshold || DEFAULT_VERTICAL_THRESHOLD
        );
        if (airprox) aircraft.calculated.airprox = airprox;
    },
    evaluate: (aircraft) => aircraft.calculated.airprox.hasAirprox,
    sort: (a, b) => {
        a = a.calculated.airprox;
        b = b.calculated.airprox;
        const catA = categoryOrder[a.riskCategory],
            catB = categoryOrder[b.riskCategory];
        return catA === catB ? a.horizontalDistance - b.horizontalDistance : catA - catB;
    },
    getStats: (aircrafts, list) => {
        const byCategory = list
            .map((aircraft) => aircraft.calculated.airprox.riskCategory)
            .reduce((counts, category) => ({ ...counts, [category]: (counts[category] || 0) + 1 }), {});
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
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
