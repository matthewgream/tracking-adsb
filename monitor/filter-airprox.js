// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Airprox (aircraft proximity) detection with enhanced risk assessment
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };
const { isLikelyFormation } = require('./filter-helpers.js');
const { isReliable } = require('./aircraft-data.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const AIRPROX_CONSTANTS = {
    // Default thresholds
    HORIZONTAL_THRESHOLD: 1, // NM
    VERTICAL_THRESHOLD: 1000, // feet
    CLOSURE_RATE_THRESHOLD: 400, // knots

    // Risk category thresholds (based on ICAO standards)
    RISK_THRESHOLDS: {
        A: { horizontal: 0.25, vertical: 500 }, // Serious risk of collision
        B: { horizontal: 0.5, vertical: 500 }, // Safety not assured
        C: { horizontal: 1, vertical: 1000 }, // No risk of collision
        D: { horizontal: 5, vertical: 2000 }, // Risk not determined
    },

    // Time and velocity thresholds
    MAX_CLOSURE_TIME: 600, // 10 minutes
    MIN_CLOSURE_VELOCITY: 0.1, // knots

    // Data quality thresholds
    MAX_POSITION_AGE: 30, // seconds
    MAX_ALTITUDE_DISCREPANCY: 500, // feet

    // Wake turbulence categories (simplified)
    WAKE_CATEGORIES: {
        A5: 'H', // Heavy
        A4: 'M', // Medium (B757)
        A3: 'M', // Medium
        A2: 'M', // Medium
        A1: 'L', // Light
        A7: 'L', // Rotorcraft
        B1: 'L', // Glider
        B4: 'L', // Ultralight
    },

    // TCAS/Alert status weights
    TCAS_WEIGHTS: {
        clear: 1, // Normal operations
        advisory: 1.2, // Traffic advisory (TA)
        resolution: 1.5, // Resolution advisory (RA) - serious!
        unknown: 1, // No TCAS data
    },

    // Risk modifiers based on conditions
    RISK_MODIFIERS: {
        highClosureRate: 1.5, // Multiply risk score
        lowAltitude: 1.3, // Less recovery time
        wakeTurbulence: 1.4, // Heavy followed by light
        maneuvering: 1.2, // Unpredictable paths
        poorDataQuality: 0.8, // Reduce confidence
        tcasAlert: 1.5, // TCAS resolution advisory active
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function createBoundingBoxFilter(centerLat, centerLon, radiusKm) {
    // Rough conversion (more accurate would account for latitude)
    const latRange = radiusKm / 111; // ~111km per degree latitude
    const lonRange = radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180));

    return {
        minLat: centerLat - latRange,
        maxLat: centerLat + latRange,
        minLon: centerLon - lonRange,
        maxLon: centerLon + lonRange,
        check: (lat, lon) => lat >= this.minLat && lat <= this.maxLat && lon >= this.minLon && lon <= this.maxLon,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateClosureDetails(aircraft, other) {
    // Input validation
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

    for (const [key, value] of Object.entries(required)) {
        if (value === undefined || value === null) {
            return { error: `Missing required field: ${key}`, closureRate: undefined, closureTime: undefined };
        }
    }

    // Coordinate validation
    const aircraftCheck = tools.validateCoordinates(aircraft.lat, aircraft.lon);
    if (!aircraftCheck.valid) {
        return { error: `Aircraft 1 ${aircraftCheck.error}`, closureRate: undefined, closureTime: undefined };
    }

    const otherCheck = tools.validateCoordinates(other.lat, other.lon);
    if (!otherCheck.valid) {
        return { error: `Aircraft 2 ${otherCheck.error}`, closureRate: undefined, closureTime: undefined };
    }

    // Track and speed validation
    const validations = [
        tools.validateNumber(aircraft.track, 0, 360, 'aircraft 1 track'),
        tools.validateNumber(aircraft.gs, 0, 2000, 'aircraft 1 ground speed'),
        tools.validateNumber(other.track, 0, 360, 'aircraft 2 track'),
        tools.validateNumber(other.gs, 0, 2000, 'aircraft 2 ground speed'),
    ];

    for (const check of validations) {
        if (!check.valid) {
            return { error: check.error, closureRate: undefined, closureTime: undefined };
        }
    }

    // Core calculations
    const velocityComponents1 = tools.calculateVelocityComponents(aircraft.track, aircraft.gs);
    const velocityComponents2 = tools.calculateVelocityComponents(other.track, other.gs);
    const relativeVelocity = {
        x: velocityComponents2.x - velocityComponents1.x,
        y: velocityComponents2.y - velocityComponents1.y,
    };
    const closureRate = Math.hypot(relativeVelocity.x, relativeVelocity.y);
    const currentDistance = tools.calculateDistance(aircraft.lat, aircraft.lon, other.lat, other.lon).distance;
    const { bearing } = tools.calculateBearing(aircraft.lat, aircraft.lon, other.lat, other.lon);
    const closureAnalysis = tools.calculateClosureGeometry(aircraft, other, relativeVelocity, bearing, currentDistance);

    let closureTime, closestApproach;
    if (closureAnalysis.valid && Math.abs(closureAnalysis.closureVelocity) > AIRPROX_CONSTANTS.MIN_CLOSURE_VELOCITY) {
        const timeToClosest = closureAnalysis.timeToClosestApproach;
        if (timeToClosest > 0 && timeToClosest < AIRPROX_CONSTANTS.MAX_CLOSURE_TIME) {
            closureTime = timeToClosest;
            const closestPoint1 = tools.calculateProjectedPosition(aircraft.lat, aircraft.lon, tools.knotsToKmPerMin(aircraft.gs).value * (timeToClosest / 60), aircraft.track);
            const closestPoint2 = tools.calculateProjectedPosition(other.lat, other.lon, tools.knotsToKmPerMin(other.gs).value * (timeToClosest / 60), other.track);
            closestApproach = {
                distance: tools.calculateDistance(closestPoint1.lat, closestPoint1.lon, closestPoint2.lat, closestPoint2.lon).distance,
                timeSeconds: timeToClosest,
                position1: closestPoint1,
                position2: closestPoint2,
            };
        } else if (timeToClosest < 0) {
            closureTime = timeToClosest;
        }
    }

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
        geometry: closureAnalysis.valid
            ? {
                  bearingDiff: Number((closureAnalysis.bearingDiff || 0).toFixed(1)),
                  aspectAngle: Number((closureAnalysis.aspectAngle || 0).toFixed(1)),
                  crossingAngle: Number((closureAnalysis.crossingAngle || 0).toFixed(1)),
              }
            : {
                  bearingDiff: 0,
                  aspectAngle: 0,
                  crossingAngle: 0,
              },
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateEnhancedRiskCategory(horizontalDistance, verticalSeparation, closureRate, aircraft1, aircraft2) {
    const { RISK_THRESHOLDS, RISK_MODIFIERS, WAKE_CATEGORIES, CLOSURE_RATE_THRESHOLD, TCAS_WEIGHTS } = AIRPROX_CONSTANTS;

    // Base risk category
    let score = 0;
    let factors = [];

    // Calculate base risk from separation
    for (const [category, thresholds] of Object.entries(RISK_THRESHOLDS)) {
        if (horizontalDistance < tools.nmToKm(thresholds.horizontal).value && verticalSeparation < thresholds.vertical) {
            score = 4 - ['A', 'B', 'C', 'D'].indexOf(category);
            factors.push({
                factor: 'separation',
                category,
                horizontal: horizontalDistance,
                vertical: verticalSeparation,
            });
            break;
        }
    }

    // Apply risk modifiers
    let confidence = 1;

    // High closure rate modifier
    if (closureRate && closureRate > CLOSURE_RATE_THRESHOLD) {
        score *= RISK_MODIFIERS.highClosureRate;
        factors.push({
            factor: 'highClosureRate',
            value: closureRate,
            modifier: RISK_MODIFIERS.highClosureRate,
        });
    }

    // Low altitude modifier
    const altitude = aircraft1.calculated?.altitude || 0;
    if (altitude < 2000 && altitude > 0) {
        score *= RISK_MODIFIERS.lowAltitude;
        factors.push({
            factor: 'lowAltitude',
            value: altitude,
            modifier: RISK_MODIFIERS.lowAltitude,
        });
    }

    // Wake turbulence check
    const wake1 = WAKE_CATEGORIES[aircraft1.category] || 'M';
    const wake2 = WAKE_CATEGORIES[aircraft2.category] || 'M';
    if (wake1 === 'H' && wake2 === 'L' && aircraft1.calculated?.altitude > aircraft2.calculated?.altitude) {
        score *= RISK_MODIFIERS.wakeTurbulence;
        factors.push({
            factor: 'wakeTurbulence',
            leader: wake1,
            follower: wake2,
            modifier: RISK_MODIFIERS.wakeTurbulence,
        });
    }

    // Maneuvering aircraft
    const maneuvering1 = aircraft1.track_rate && Math.abs(aircraft1.track_rate) > 3;
    const maneuvering2 = aircraft2.track_rate && Math.abs(aircraft2.track_rate) > 3;
    if (maneuvering1 || maneuvering2) {
        score *= RISK_MODIFIERS.maneuvering;
        factors.push({
            factor: 'maneuvering',
            aircraft1: maneuvering1,
            aircraft2: maneuvering2,
            modifier: RISK_MODIFIERS.maneuvering,
        });
    }

    // TCAS/Alert status check
    const alert1 = aircraft1.alert || 'unknown';
    const alert2 = aircraft2.alert || 'unknown';
    const tcasWeight = Math.max(TCAS_WEIGHTS[alert1] || 1, TCAS_WEIGHTS[alert2] || 1);
    if (tcasWeight > 1) {
        score *= tcasWeight;
        factors.push({
            factor: 'tcasAlert',
            aircraft1Alert: alert1,
            aircraft2Alert: alert2,
            modifier: tcasWeight,
        });

        // If either has resolution advisory, it's very serious
        if (alert1 === 'resolution' || alert2 === 'resolution') {
            confidence *= 1.2; // Higher confidence - TCAS is reliable
        }
    }

    // Data quality check
    const positionQuality1 = isReliable(aircraft1, 'position');
    const positionQuality2 = isReliable(aircraft2, 'position');
    const altitudeQuality1 = isReliable(aircraft1, 'altitude');
    const altitudeQuality2 = isReliable(aircraft2, 'altitude');

    const avgDataConfidence = (positionQuality1.confidence + positionQuality2.confidence + altitudeQuality1.confidence + altitudeQuality2.confidence) / 4;

    if (avgDataConfidence < 0.8) {
        confidence *= avgDataConfidence;
        factors.push({
            factor: 'dataQuality',
            confidence: avgDataConfidence,
            issues: [...positionQuality1.issues, ...positionQuality2.issues, ...altitudeQuality1.issues, ...altitudeQuality2.issues],
        });
    }

    let category;
    if (score >= 3.5) category = 'A';
    else if (score >= 2.5) category = 'B';
    else if (score >= 1.5) category = 'C';
    else category = 'D';

    return {
        category,
        score,
        confidence,
        factors,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAirprox(conf, aircraft, aircraftList) {
    const horizontalThreshold = conf.horizontalThreshold || AIRPROX_CONSTANTS.HORIZONTAL_THRESHOLD;
    const verticalThreshold = conf.verticalThreshold || AIRPROX_CONSTANTS.VERTICAL_THRESHOLD;

    // Early exits
    if (aircraft.lat === undefined || aircraft.lon === undefined || !aircraft.calculated?.altitude) {
        return undefined;
    }

    // Skip if near airports (unless configured otherwise)
    if (!conf.includeAirportProximity && aircraft.calculated?.airports_nearby?.hasAirportsNearby) {
        return undefined;
    }

    // Check data reliability
    const positionCheck = isReliable(aircraft, 'position');
    if (!positionCheck.reliable && !conf.allowUnreliableData) {
        return undefined;
    }

    const horizontalThresholdKm = tools.nmToKm(horizontalThreshold).value;

    // TCAS override thresholds
    const hasTcasAlert = aircraft.alert > 0;
    const effectiveHorizontalThreshold = hasTcasAlert
        ? Math.max(horizontalThresholdKm, tools.nmToKm(5).value) // Expand to 5nm for TCAS
        : horizontalThresholdKm;
    const effectiveVerticalThreshold = hasTcasAlert
        ? Math.max(verticalThreshold, 1200) // Expand to 1200ft for TCAS
        : verticalThreshold;

    // Performance optimization: create bounding box
    const boundingBox = createBoundingBoxFilter(
        aircraft.lat,
        aircraft.lon,
        effectiveHorizontalThreshold * 1.5 // 50% margin
    );

    // Filter proximate aircraft
    const proximateAircraft = aircraftList.filter((other) => {
        // Skip self and already processed
        if (other.hex === aircraft.hex || other.calculated?.airprox) return false;

        // Quick bounding box check
        if (other.lat === undefined || other.lon === undefined) return false;
        if (Math.abs(other.lat - aircraft.lat) > boundingBox.maxLat - boundingBox.minLat) return false;
        if (Math.abs(other.lon - aircraft.lon) > boundingBox.maxLon - boundingBox.minLon) return false;

        // Skip if near airports (unless configured OR has TCAS alert)
        if (!hasTcasAlert && !conf.includeAirportProximity && other.calculated?.airports_nearby?.hasAirportsNearby) return false;

        // Skip if no altitude
        if (!other.calculated?.altitude) return false;

        // Skip if stale data (unless TCAS alert)
        if (!hasTcasAlert && other.seen_pos > AIRPROX_CONSTANTS.MAX_POSITION_AGE) return false;

        // Precise distance check
        const horizontalDistance = tools.calculateDistance(aircraft.lat, aircraft.lon, other.lat, other.lon).distance;
        if (horizontalDistance > effectiveHorizontalThreshold) return false;

        // Vertical separation check
        const verticalSeparation = Math.abs(aircraft.calculated.altitude - other.calculated.altitude);
        if (verticalSeparation > effectiveVerticalThreshold) return false;

        // Formation flight check (skip if TCAS alert - TCAS doesn't care about formations)
        if (!hasTcasAlert && conf.excludeFormation) {
            const formationCheck = isLikelyFormation(aircraft, other);
            if (formationCheck.isFormation) return false;
        }

        return true;
    });

    if (proximateAircraft.length === 0) return undefined;

    // Find closest threat
    const [otherAircraft] = proximateAircraft.sort((a, b) => {
        const distA = tools.calculateDistance(aircraft.lat, aircraft.lon, a.lat, a.lon).distance;
        const distB = tools.calculateDistance(aircraft.lat, aircraft.lon, b.lat, b.lon).distance;
        return distA - distB;
    });

    // Calculate detailed proximity information
    const horizontalDistance = tools.calculateDistance(aircraft.lat, aircraft.lon, otherAircraft.lat, otherAircraft.lon).distance;
    const verticalSeparation = Math.abs(aircraft.calculated.altitude - otherAircraft.calculated.altitude);
    const closureDetails = calculateClosureDetails(aircraft, otherAircraft);

    // Enhanced risk assessment
    const riskAssessment = calculateEnhancedRiskCategory(horizontalDistance, verticalSeparation, closureDetails.closureRate, aircraft, otherAircraft);

    // Check if this is likely a formation
    const formationCheck = isLikelyFormation(aircraft, otherAircraft);

    // Data quality assessment
    const dataQuality = {
        positionAge: Math.max(aircraft.seen_pos || 0, otherAircraft.seen_pos || 0),
        altitudeSource1: aircraft.alt_baro ? 'barometric' : 'geometric',
        altitudeSource2: otherAircraft.alt_baro ? 'barometric' : 'geometric',
        reliability: (isReliable(aircraft, 'position').confidence + isReliable(otherAircraft, 'position').confidence + isReliable(aircraft, 'altitude').confidence + isReliable(otherAircraft, 'altitude').confidence) / 4,
    };

    return {
        hasAirprox: true,
        otherAircraft,
        horizontalDistance,
        verticalSeparation,
        closureRate: closureDetails.closureRate,
        closureTime: closureDetails.closureTime,
        closureVelocity: closureDetails.closureVelocity,
        isConverging: closureDetails.isConverging,
        riskCategory: riskAssessment.category,
        riskScore: riskAssessment.score,
        riskConfidence: riskAssessment.confidence,
        riskFactors: riskAssessment.factors,
        proximateCount: proximateAircraft.length,
        isFormation: formationCheck.isFormation,
        formationConfidence: formationCheck.confidence,
        relativeAltitude: aircraft.calculated.altitude > otherAircraft.calculated.altitude ? 'above' : 'below',
        convergenceAngle: closureDetails.geometry?.crossingAngle,
        dataQuality,
        closestApproach: closureDetails.closestApproach,
        tcasStatus: {
            aircraft1: aircraft.alert || 'unknown',
            aircraft2: otherAircraft.alert || 'unknown',
            hasResolutionAdvisory: aircraft.alert === 'resolution' || otherAircraft.alert === 'resolution',
            hasTrafficAdvisory: aircraft.alert === 'advisory' || otherAircraft.alert === 'advisory',
        },
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
        // Merge with defaults
        this.conf = {
            horizontalThreshold: AIRPROX_CONSTANTS.HORIZONTAL_THRESHOLD,
            verticalThreshold: AIRPROX_CONSTANTS.VERTICAL_THRESHOLD,
            closureRateThreshold: AIRPROX_CONSTANTS.CLOSURE_RATE_THRESHOLD,
            excludeFormation: true,
            includeAirportProximity: false,
            allowUnreliableData: false,
            ...conf,
        };
        this.extra = extra;

        console.error(`filter-airprox: configured: ${this.conf.horizontalThreshold}nm horizontal, ${this.conf.verticalThreshold}ft vertical, formation detection: ${this.conf.excludeFormation ? 'enabled' : 'disabled'}`);
    },

    preprocess: (aircraft, { aircraftList }) => {
        aircraft.calculated.airprox = { hasAirprox: false };
        const airprox = detectAirprox(this.conf, aircraft, aircraftList);
        if (airprox) aircraft.calculated.airprox = airprox;
    },

    evaluate: (aircraft) => aircraft.calculated.airprox.hasAirprox,

    sort: (a, b) => {
        const a_ = a.calculated.airprox;
        const b_ = b.calculated.airprox;

        // Sort by risk category first
        if (categoryOrder[a_.riskCategory] !== categoryOrder[b_.riskCategory]) {
            return categoryOrder[a_.riskCategory] - categoryOrder[b_.riskCategory];
        }

        // Then by risk score (higher score = higher priority)
        if (a_.riskScore !== b_.riskScore) {
            return b_.riskScore - a_.riskScore;
        }

        // Then by horizontal distance
        if (a_.horizontalDistance !== b_.horizontalDistance) {
            return a_.horizontalDistance - b_.horizontalDistance;
        }

        // Finally by vertical separation
        return a_.verticalSeparation - b_.verticalSeparation;
    },

    getStats: (aircrafts, list) => {
        const byCategory = {};
        const byFormation = { formation: 0, notFormation: 0 };
        const dataQualitySum = { total: 0, count: 0 };

        list.forEach((aircraft) => {
            const { airprox } = aircraft.calculated;

            // Category stats
            byCategory[airprox.riskCategory] = (byCategory[airprox.riskCategory] || 0) + 1;

            // Formation stats
            if (airprox.isFormation) {
                byFormation.formation++;
            } else {
                byFormation.notFormation++;
            }

            // Data quality stats
            if (airprox.dataQuality?.reliability) {
                dataQualitySum.total += airprox.dataQuality.reliability;
                dataQualitySum.count++;
            }
        });

        return {
            byCategory,
            categoryA: byCategory.A || 0,
            categoryB: byCategory.B || 0,
            categoryC: byCategory.C || 0,
            categoryD: byCategory.D || 0,
            byFormation,
            averageDataQuality: dataQualitySum.count > 0 ? (dataQualitySum.total / dataQualitySum.count).toFixed(2) : 'N/A',
            total: list.length,
        };
    },

    format: (aircraft) => {
        const { airprox } = aircraft.calculated;
        const { closureTime, riskCategory, verticalSeparation, horizontalDistance, otherAircraft, isFormation, riskConfidence, riskScore, closureRate, dataQuality, tcasStatus } = airprox;

        // Build proximity description
        let proximityDescription = 'proximity alert';
        if (closureTime !== undefined) {
            const timeToCA = Math.round(closureTime);
            proximityDescription = timeToCA > 0 ? `convergence in ~${timeToCA}s` : 'diverging';
        }

        // Add formation indicator
        const formationText = isFormation ? ' (likely formation)' : '';

        // Add confidence indicator for low confidence
        const confidenceText = riskConfidence < 0.7 ? ' [low confidence]' : '';

        // Add TCAS alert indicator
        let tcasText = '';
        if (tcasStatus?.hasResolutionAdvisory) tcasText = ' *TCAS RA*';
        else if (tcasStatus?.hasTrafficAdvisory) tcasText = ' [TCAS TA]';

        return {
            text: `airprox ${riskCategory} with ${otherAircraft.flight || otherAircraft.hex} - ${horizontalDistance.toFixed(1)}km/${verticalSeparation}ft separation - ${proximityDescription}${formationText}${tcasText}${confidenceText}`,
            warn: riskCategory === 'A' || riskCategory === 'B',
            airproxInfo: {
                otherFlight: otherAircraft.flight,
                otherHex: otherAircraft.hex,
                horizontalDistance,
                verticalSeparation,
                riskCategory,
                riskScore,
                riskConfidence,
                closureRate,
                closureTime,
                isFormation,
                dataQuality,
            },
        };
    },

    debug: (type, aircraft) => {
        const { airprox } = aircraft.calculated;
        if (type === 'sorting') {
            return `risk=${airprox.riskCategory}, score=${airprox.riskScore.toFixed(2)}, dist=${airprox.horizontalDistance.toFixed(1)}km, vsep=${airprox.verticalSeparation}ft`;
        }
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
