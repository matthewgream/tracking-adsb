// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const DEFAULT_HORIZONTAL_THRESHOLD = 1; // NM, converted to km
const DEFAULT_VERTICAL_THRESHOLD = 1000; // feet
//const DEFAULT_AIRPORT_EXCLUSION_RADIUS = 5; // km - don't report airprox near airports
const DEFAULT_CLOSURE_RATE_THRESHOLD = 400; // knots - high closure rate increases severity

function nmToKm(nm) {
    return nm * 1.852;
}

function detectAirprox(aircraft, aircraftList, horizontalThreshold, verticalThreshold) {
    if (!aircraft.lat || !aircraft.lon || !aircraft.calculated.altitude) return undefined;
    if (aircraft.calculated.airports_nearby && aircraft.calculated.airports_nearby.length > 0) return undefined;

    const horizontalThresholdKm = nmToKm(horizontalThreshold);

    const proximateAircraft = aircraftList.filter((other) => {
        if (other.calculated.airprox) return false;
        if (other.hex === aircraft.hex) return false;
        if (other.calculated?.airports_nearby && other.calculated.airports_nearby.length > 0) return false;
        if (!other.lat || !other.lon || !other.calculated?.altitude) return false;

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
    const horizontalDistance = helpers.calculateDistance(aircraft.lat, aircraft.lon, otherAircraft.lat, otherAircraft.lon),
        verticalSeparation = Math.abs(aircraft.calculated.altitude - otherAircraft.calculated.altitude);

    let closureRate, closureTime;
    if (aircraft.track && aircraft.gs && otherAircraft.track && otherAircraft.gs) {
        const track1Rad = helpers.track2rad(aircraft.track),
            track2Rad = helpers.track2rad(otherAircraft.track);
        const vx1 = aircraft.gs * Math.cos(track1Rad),
            vy1 = aircraft.gs * Math.sin(track1Rad),
            vx2 = otherAircraft.gs * Math.cos(track2Rad),
            vy2 = otherAircraft.gs * Math.sin(track2Rad);
        const relVx = vx2 - vx1,
            relVy = vy2 - vy1;
        closureRate = Math.hypot(relVx, relVy);
        const bearingRad = helpers.deg2rad(helpers.calculateBearing(aircraft.lat, aircraft.lon, otherAircraft.lat, otherAircraft.lon));
        const closureVelocity = relVx * Math.cos(bearingRad) + relVy * Math.sin(bearingRad);
        if (Math.abs(closureVelocity) > 0.1) {
            const timeSeconds = (horizontalDistance * 1000) / Math.abs(closureVelocity * 0.514444);
            closureTime = closureVelocity < 0 ? timeSeconds : -timeSeconds;
            if (Math.abs(closureTime) > 600) closureTime = undefined;
        }
    }

    let riskCategory;
    if (horizontalDistance < nmToKm(0.25) && verticalSeparation < 500)
        riskCategory = 'A'; // Serious risk of collision
    else if (horizontalDistance < nmToKm(0.5) && verticalSeparation < 500)
        riskCategory = 'B'; // Safety not assured
    else if (horizontalDistance < nmToKm(1))
        riskCategory = 'C'; // No risk of collision
    else riskCategory = 'D'; // Risk not determined
    if (closureRate && closureRate > DEFAULT_CLOSURE_RATE_THRESHOLD) {
        if (riskCategory === 'C') riskCategory = 'B';
        if (riskCategory === 'B') riskCategory = 'A';
    }

    return {
        hasAirprox: true,
        otherAircraft,
        horizontalDistance, // in km
        verticalSeparation, // in feet
        closureRate, // in knots, can be null
        closureTime, // in seconds, can be null
        riskCategory, // A, B, C, or D
        proximateCount: proximateAircraft.length, // How many aircraft are too close
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'airprox',
    name: 'Aircraft proximity warning',
    enabled: true,
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
        const categoryOrder = { A: 0, B: 1, C: 2, D: 3 };
        const catA = categoryOrder[a.calculated.airprox.riskCategory],
            catB = categoryOrder[b.calculated.airprox.riskCategory];
        return catA === catB ? a.calculated.airprox.horizontalDistance - b.calculated.airprox.horizontalDistance : catA - catB;
    },
    getStats: (aircrafts) => {
        const list = aircrafts.filter((a) => a.calculated.airprox.hasAirprox);
        const byCategory = list
            .map((aircraft) => aircraft.calculated.airprox.riskCategory)
            .reduce((counts, category) => ({ ...counts, [category]: (counts[category] || 0) + 1 }), {});
        return {
            ...this.extra.format.getStats_List('aircraft-airprox', list),
            categoryA: byCategory.A || 0,
            categoryB: byCategory.B || 0,
            categoryC: byCategory.C || 0,
            categoryD: byCategory.D || 0,
            byCategory,
        };
    },
    format: (aircraft) => {
        let proximityDescription = `proximity alert`;
        const { closureTime, closureRate, riskCategory, verticalSeparation, horizontalDistance, otherAircraft } = aircraft.calculated.airprox;
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
