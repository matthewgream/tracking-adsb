// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// filter-airport.js - Aircraft near airport detection with enhanced analysis
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');
const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js'), ...require('./tools-formats.js') };
const aircraftInfo = require('./aircraft-info.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect potential go-around maneuver
 * @param {Object} aircraft - Aircraft object
 * @param {Object} aircraftData - Aircraft trajectory data
 * @param {Object} airport - Airport object
 * @returns {Object|undefined } Go-around detection result
 */
function detectGoAround(aircraft, aircraftData, airport) {
    if (!aircraftData || !aircraft.baro_rate) return undefined;

    // Get recent altitude history
    const altitudes = aircraftData.getField('calculated.altitude', { maxDataPoints: 10 });
    const verticalRates = aircraftData.getField('baro_rate', { maxDataPoints: 10 });

    if (altitudes.values.length < 5) return undefined;

    // Look for pattern: descending -> level/climb at low altitude
    const recentAltitudes = altitudes.values.slice(-5);
    const recentRates = verticalRates.values.slice(-5);

    // Analyze altitude trend
    const minAltitude = Math.min(...recentAltitudes);
    const maxAltitude = Math.max(...recentAltitudes);
    const currentAltitude = aircraft.calculated.altitude;

    // Check altitude pattern: was low, now climbing
    const wasLow = minAltitude < 1500;
    const altitudeGain = currentAltitude - minAltitude;
    const significantClimb = altitudeGain > 300; // Gained at least 300ft from minimum

    // Check if was descending then started climbing
    const wasDescending = recentRates.slice(0, 3).some((rate) => rate < -400);
    const nowClimbing = aircraft.baro_rate > 500;
    const nearAirport = airport.distance < 10;

    // Enhanced confidence calculation based on pattern clarity
    let confidence = 0.5;

    if (wasDescending && nowClimbing && wasLow && nearAirport) {
        // Increase confidence based on pattern strength
        if (significantClimb) confidence += 0.2;
        if (minAltitude < 1000) confidence += 0.1; // Very low approach
        if (aircraft.baro_rate > 1000) confidence += 0.1; // Strong climb
        if (altitudeGain > 500) confidence += 0.1; // Significant altitude recovery

        // Check for "valley" pattern in altitudes (down then up)
        const midPoint = Math.floor(recentAltitudes.length / 2);
        const firstHalf = recentAltitudes.slice(0, midPoint);
        const secondHalf = recentAltitudes.slice(midPoint);
        const firstHalfAvg = firstHalf.reduce((a, b) => a + b) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((a, b) => a + b) / secondHalf.length;

        if (secondHalfAvg > firstHalfAvg + 200) {
            confidence += 0.1; // Clear V-shaped altitude profile
        }

        confidence = Math.min(1, confidence);

        return {
            detected: true,
            confidence: Number(confidence.toFixed(2)),
            altitude: currentAltitude,
            minAltitude,
            altitudeGain,
            climbRate: aircraft.baro_rate,
            phase: 'go_around',
            pattern: {
                wasDescending,
                altitudeRange: maxAltitude - minAltitude,
                lowestPoint: minAltitude,
                recovery: altitudeGain,
            },
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect holding pattern behavior
 * @param {Object} aircraftData - Aircraft trajectory data
 * @returns {Object|undefined } Holding pattern detection result
 */
function detectHoldingPattern(aircraftData) {
    if (!aircraftData) return undefined;

    const positions = aircraftData.getPositions({ maxDataPoints: 30 });
    if (positions.length < 20) return undefined;

    // Look for circular/racetrack patterns
    const tracks = positions.map((p) => p.track).filter((t) => t !== undefined);
    if (tracks.length < 15) return undefined;

    // Calculate total heading change
    let totalHeadingChange = 0;
    for (let i = 1; i < tracks.length; i++) {
        const change = Math.abs(helpers.angleDifference(tracks[i], tracks[i - 1]));
        totalHeadingChange += change;
    }

    // Holding patterns involve continuous turns
    const isHolding = totalHeadingChange > 540; // More than 1.5 circles

    if (isHolding) {
        // Calculate holding area
        const lats = positions.map((p) => p.lat);
        const lons = positions.map((p) => p.lon);
        const centerLat = lats.reduce((a, b) => a + b) / lats.length;
        const centerLon = lons.reduce((a, b) => a + b) / lons.length;

        return {
            detected: true,
            pattern: 'holding',
            centerLat,
            centerLon,
            totalTurn: totalHeadingChange,
            duration: (positions[positions.length - 1].timestamp - positions[0].timestamp) / 1000,
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Estimate position in approach/departure queue
 * @param {Object} aircraft - Current aircraft
 * @param {Object} airport - Airport object
 * @param {Array} allAircraft - All aircraft in the area
 * @returns {Object} Queue position info
 */
function detectQueuePosition(aircraft, airport, allAircraft) {
    // Find other aircraft approaching/departing same airport
    const sameAirport = allAircraft.filter((other) => {
        if (other.hex === aircraft.hex) return false;
        if (!other.calculated?.airports_nearby?.airports) return false;

        return other.calculated.airports_nearby.airports.some((apt) => apt.icao_code === airport.icao_code && (apt.phase === 'approaching' || apt.phase === 'departing'));
    });

    // Separate by phase
    const approaching = sameAirport.filter((a) => a.calculated.airports_nearby.airports.find((apt) => apt.icao_code === airport.icao_code)?.phase === 'approaching');

    const departing = sameAirport.filter((a) => a.calculated.airports_nearby.airports.find((apt) => apt.icao_code === airport.icao_code)?.phase === 'departing');

    // Calculate queue position for approaches (closer = sooner)
    let approachPosition = 0;
    if (airport.phase === 'approaching') {
        approaching.forEach((other) => {
            const otherAirport = other.calculated.airports_nearby.airports.find((apt) => apt.icao_code === airport.icao_code);
            if (otherAirport && otherAirport.distance < airport.distance) {
                approachPosition++;
            }
        });
    }

    return {
        phase: airport.phase,
        queuePosition: approachPosition,
        totalInPhase: airport.phase === 'approaching' ? approaching.length : departing.length,
        approachingCount: approaching.length,
        departingCount: departing.length,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect if aircraft is in a traffic pattern (circuit)
 * @param {Object} aircraft - Aircraft object
 * @param {Object} aircraftData - Aircraft trajectory data
 * @param {Object} airport - Airport object
 * @returns {Object|undefined} Pattern detection result
 */
function detectTrafficPattern(aircraft, aircraftData, airport) {
    if (!aircraftData) return undefined;

    // Pattern work typically happens at specific altitudes
    const patternAltitude = (airport.elevation_ft || 0) + 1000; // Standard pattern altitude
    const altitudeTolerance = 200; // feet

    // Check if at pattern altitude
    const atPatternAltitude = aircraft.calculated?.altitude && Math.abs(aircraft.calculated.altitude - patternAltitude) < altitudeTolerance;

    // Early return if not at pattern altitude
    if (!atPatternAltitude) return undefined;

    // Get recent positions and tracks
    const positions = aircraftData.getPositions({ maxDataPoints: 20 });
    if (positions.length < 10) return undefined;

    // Pattern characteristics:
    // 1. Consistent altitude (already checked)
    // 2. Rectangular flight path with ~90 degree turns
    // 3. Within pattern distance of airport (typically 1-2nm)

    const tracks = positions.map((p) => p.track).filter((t) => t !== undefined);
    if (tracks.length < 10) return undefined;

    // Check altitude consistency throughout the pattern
    const altitudes = positions.map((p) => p.altitude).filter((a) => a !== undefined);
    let altitudeConsistent = true;
    if (altitudes.length > 5) {
        const minAlt = Math.min(...altitudes);
        const maxAlt = Math.max(...altitudes);
        altitudeConsistent = maxAlt - minAlt < 300; // Should maintain altitude within 300ft
    }

    // Look for 90-degree turns (pattern legs)
    const turns = [];
    for (let i = 1; i < tracks.length; i++) {
        const change = helpers.angleDifference(tracks[i], tracks[i - 1]);
        if (Math.abs(Math.abs(change) - 90) < 20) {
            // ~90 degree turn
            turns.push({
                index: i,
                angle: change,
                track: tracks[i],
            });
        }
    }

    // Check distance consistency (should stay within pattern distance)
    const distances = positions.map((p) => tools.calculateDistance(airport.latitude_deg, airport.longitude_deg, p.lat, p.lon).distance);
    const avgDistance = distances.reduce((a, b) => a + b) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);

    // Typical pattern is within 2nm (3.7km) of airport
    const inPatternDistance = maxDistance < 4 && avgDistance < 3;

    // Calculate confidence based on pattern characteristics
    let confidence = 0.5;
    if (atPatternAltitude) confidence += 0.2;
    if (altitudeConsistent) confidence += 0.1;
    if (turns.length >= 3) confidence += 0.1;
    if (turns.length >= 4) confidence += 0.1; // Full pattern
    if (inPatternDistance) confidence += 0.1;

    // Determine pattern type
    if (turns.length >= 2 && inPatternDistance && altitudeConsistent) {
        // Analyze turn directions to determine pattern direction
        const leftTurns = turns.filter((t) => t.angle < 0).length;
        const rightTurns = turns.filter((t) => t.angle > 0).length;

        // Check for consistent turn direction (good pattern discipline)
        const consistentDirection = Math.abs(leftTurns - rightTurns) === turns.length;
        if (consistentDirection) confidence += 0.1;

        return {
            detected: true,
            type: 'traffic_pattern',
            direction: leftTurns > rightTurns ? 'left' : 'right',
            patternAltitude: Math.round(aircraft.calculated.altitude),
            expectedPatternAlt: patternAltitude,
            altitudeDeviation: Math.abs(aircraft.calculated.altitude - patternAltitude),
            altitudeConsistent,
            turnCount: turns.length,
            turns,
            distanceRange: {
                min: minDistance.toFixed(1),
                max: maxDistance.toFixed(1),
                avg: avgDistance.toFixed(1),
            },
            confidence: Math.min(1, confidence).toFixed(2),
            phase: 'pattern',
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect overhead join maneuver (common at UK airports)
 * @param {Object} aircraft - Aircraft object
 * @param {Object} aircraftData - Aircraft trajectory data
 * @param {Object} airport - Airport object
 * @returns {Object|undefined} Overhead join detection result
 */
function detectOverheadJoin(aircraft, aircraftData, airport) {
    if (!aircraftData || !aircraft.baro_rate) return undefined;

    // Overhead join characteristics:
    // 1. Pass overhead at 1000-2000ft above pattern altitude
    // 2. Descending turn to join pattern

    const patternAltitude = (airport.elevation_ft || 0) + 1000;
    const overheadAltitude = patternAltitude + 1000; // 2000ft above field

    // Check if at overhead altitude and descending
    const atOverheadAlt = aircraft.calculated?.altitude && Math.abs(aircraft.calculated.altitude - overheadAltitude) < 300;
    const descending = aircraft.baro_rate < -200;
    const overAirport = airport.distance < 1; // Within 1km

    if (atOverheadAlt && descending && overAirport) {
        return {
            detected: true,
            type: 'overhead_join',
            altitude: aircraft.calculated.altitude,
            descentRate: aircraft.baro_rate,
            phase: 'overhead_join',
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect touch-and-go pattern (training flights)
 * @param {Object} aircraft - Aircraft object
 * @param {Object} aircraftData - Aircraft trajectory data
 * @param {Object} airport - Airport object
 * @returns {Object|undefined} Touch-and-go detection result
 */
function detectTouchAndGo(aircraft, aircraftData, airport) {
    if (!aircraftData) return undefined;

    // Touch-and-go characteristics:
    // 1. Very low altitude near airport (< 500ft)
    // 2. Followed by climb without significant speed reduction
    // 3. Maintains pattern-like track

    const altitudes = aircraftData.getField('calculated.altitude', { maxDataPoints: 10 });
    const speeds = aircraftData.getField('gs', { maxDataPoints: 10 });

    if (altitudes.values.length < 5) return undefined;

    // Look for low approach followed by climb
    const minAltitude = Math.min(...altitudes.values.slice(-5));
    const currentAltitude = aircraft.calculated?.altitude || 0;
    const wasLow = minAltitude < (airport.elevation_ft || 0) + 500;
    const nowClimbing = aircraft.baro_rate > 300 && currentAltitude > minAltitude + 200;

    // Speed should remain relatively high (not a full stop)
    const minSpeed = Math.min(...speeds.values.slice(-5));
    const maintainedSpeed = minSpeed > 50; // knots

    if (wasLow && nowClimbing && maintainedSpeed && airport.distance < 2) {
        return {
            detected: true,
            type: 'touch_and_go',
            minAltitude,
            currentAltitude,
            phase: 'touch_and_go',
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect runway changes at an airport over time
 * @param {Array} historicalData - Array of previous analysis results
 * @param {Object} currentAnalysis - Current analysis for the airport
 * @returns {Object|undefined} Runway change detection result
 */
function detectRunwayChange(historicalData, currentAnalysis) {
    if (!historicalData || historicalData.length < 2) return undefined;
    if (!currentAnalysis.activeRunways || currentAnalysis.activeRunways.length === 0) return undefined;

    // Get current active runway
    const currentRunway = currentAnalysis.activeRunways[0].name;

    // Look for previous active runway in historical data
    let previousRunway;
    let timeOfLastRunway;

    // Go backwards through history to find last different active runway
    for (let i = historicalData.length - 1; i >= 0; i--) {
        const historical = historicalData[i];
        if (historical.activeRunways && historical.activeRunways.length > 0) {
            const historicalRunway = historical.activeRunways[0].name;
            if (historicalRunway !== currentRunway) {
                previousRunway = historicalRunway;
                timeOfLastRunway = historical.timestamp;
                break;
            }
        }
    }

    if (previousRunway) {
        // Check if runways are opposite directions (e.g., 09 vs 27)
        const isOppositeDirection = areRunwaysOpposite(currentRunway, previousRunway);

        return {
            detected: true,
            previousRunway,
            currentRunway,
            isOppositeDirection,
            // eslint-disable-next-line unicorn/prefer-date-now
            timeSinceChange: timeOfLastRunway ? (new Date() - new Date(timeOfLastRunway)) / 1000 / 60 : undefined, // minutes
            changeType: isOppositeDirection ? 'direction_reversal' : 'parallel_change',
        };
    }

    return undefined;
}

/**
 * Check if two runways are opposite directions
 * @param {string} runway1 - First runway name (e.g., "09L")
 * @param {string} runway2 - Second runway name (e.g., "27L")
 * @returns {boolean}
 */
function areRunwaysOpposite(runway1, runway2) {
    // Extract numbers from runway names
    const num1 = Number.parseInt(runway1.match(/\d+/)?.[0] || 0);
    const num2 = Number.parseInt(runway2.match(/\d+/)?.[0] || 0);

    // Opposite runways differ by 18 (180 degrees)
    const diff = Math.abs(num1 - num2);
    return diff === 18;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect missed approach procedure (different from go-around)
 * @param {Object} aircraft - Aircraft object
 * @param {Object} aircraftData - Aircraft trajectory data
 * @param {Object} airport - Airport object
 * @returns {Object|undefined} Missed approach detection result
 */
function detectMissedApproach(aircraft, aircraftData, airport) {
    if (!aircraftData || !aircraft.baro_rate) return undefined;

    // Get recent altitude and track history
    const altitudes = aircraftData.getField('calculated.altitude', { maxDataPoints: 15 });
    const tracks = aircraftData.getField('track', { maxDataPoints: 15 });
    const speeds = aircraftData.getField('gs', { maxDataPoints: 10 });

    if (altitudes.values.length < 8) return undefined;

    const recentAltitudes = altitudes.values.slice(-8);
    const recentTracks = tracks.values.slice(-8);
    const currentAltitude = aircraft.calculated.altitude;
    const minAltitude = Math.min(...recentAltitudes);

    // Decision heights typically 200-800ft AGL
    const decisionHeightRange = {
        min: (airport.elevation_ft || 0) + 200,
        max: (airport.elevation_ft || 0) + 800,
    };

    // Missed approach characteristics:
    // 1. Reached decision height but didn't continue descent
    // 2. Initiated climb from specific altitude
    // 3. Following published missed approach (often includes turn)
    // 4. Higher climb rate than typical go-around

    const reachedDecisionHeight = minAltitude >= decisionHeightRange.min && minAltitude <= decisionHeightRange.max;
    const strongClimb = aircraft.baro_rate > 800; // Stronger than go-around
    const altitudeGain = currentAltitude - minAltitude;
    const significantGain = altitudeGain > 500;

    // Check for heading change (missed approach often includes turn)
    let headingChange = 0;
    if (recentTracks.length >= 5) {
        const [initialTrack] = recentTracks;
        const currentTrack = aircraft.track;
        headingChange = Math.abs(helpers.angleDifference(initialTrack, currentTrack));
    }

    // Check approach stability before missed approach
    const speedVariation = speeds.values.length > 3 ? Math.max(...speeds.values) - Math.min(...speeds.values) : 0;
    const wasStableApproach = speedVariation < 20; // Stable approach before MA

    if (reachedDecisionHeight && strongClimb && significantGain && airport.distance < 8) {
        let confidence = 0.6;

        // Adjust confidence based on pattern
        if (headingChange > 15) confidence += 0.1; // Turn indicates following MA procedure
        if (wasStableApproach) confidence += 0.1; // Stable approach suggests planned MA
        if (aircraft.baro_rate > 1200) confidence += 0.1; // Very strong climb
        if (minAltitude < decisionHeightRange.min + 200) confidence += 0.1; // Low decision

        return {
            detected: true,
            type: 'missed_approach',
            confidence: Math.min(1, confidence),
            decisionAltitude: minAltitude,
            currentAltitude,
            altitudeGain,
            climbRate: aircraft.baro_rate,
            headingChange,
            phase: 'missed_approach',
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect type and category of approach based on flight path stability
 * @param {Object} aircraft - Aircraft object
 * @param {Object} aircraftData - Aircraft trajectory data
 * @param {Object} airport - Airport object
 * @returns {Object|undefined} Approach type detection result
 */
function detectApproachType(aircraft, aircraftData, airport) {
    if (!aircraftData || !airport.alignedRunway) return undefined;

    // Only check if approaching and aligned with runway
    if (airport.phase !== 'approaching' || aircraft.calculated.altitude > 5000) return undefined;

    const positions = aircraftData.getPositions({ maxDataPoints: 20 });
    if (positions.length < 10) return undefined;

    // Calculate glideslope angle
    const glideslope = calculateGlideslope(positions, airport);

    // Calculate lateral deviation from extended centerline
    const lateralDeviations = calculateLateralDeviations(positions, airport);

    // Calculate approach stability metrics
    const stability = calculateApproachStability(aircraftData);

    // Determine approach type based on stability
    let approachType = 'visual';
    let category;
    let confidence = 0.5;

    // ILS approaches are very stable
    if (glideslope.isStable && lateralDeviations.isStable && stability.isStable) {
        approachType = 'ILS';

        // Determine ILS category based on decision height
        const decisionHeight = aircraft.calculated.altitude - (airport.elevation_ft || 0);
        if (decisionHeight > 400) {
            category = 'CAT-I'; // DH 200ft or above
        } else if (decisionHeight > 100) {
            category = 'CAT-II'; // DH 100-200ft
        } else {
            category = 'CAT-III'; // DH below 100ft
        }

        confidence = 0.9;
    } else if (lateralDeviations.avgDeviation > 0.5) {
        // Large lateral deviation suggests circling or visual
        approachType = 'circling';
        confidence = 0.7;
    } else if (stability.speedStable && !glideslope.isStable) {
        // Stable speed but varying glideslope suggests visual
        // eslint-disable-next-line sonarjs/no-redundant-assignments
        approachType = 'visual';
        confidence = 0.8;
    }

    return {
        detected: true,
        type: approachType,
        category,
        confidence,
        glideslope: glideslope.angle,
        glisdeslopeDeviation: glideslope.deviation,
        lateralDeviation: lateralDeviations.avgDeviation,
        stability: {
            speed: stability.speedVariation,
            track: stability.trackVariation,
            descent: stability.descentVariation,
            overall: stability.isStable,
        },
        phase: `${approachType.toLowerCase()}_approach`,
    };
}

/**
 * Calculate glideslope angle and stability
 * @private
 */
function calculateGlideslope(positions, airport) {
    const altitudes = positions.map((p) => p.altitude).filter((a) => a !== undefined);
    const distances = positions.map((p) => tools.calculateDistance(airport.latitude_deg, airport.longitude_deg, p.lat, p.lon).distance);

    if (altitudes.length < 5) return { angle: 0, deviation: 0, isStable: false };

    // Calculate average glideslope angle
    const angles = [];
    for (let i = 1; i < altitudes.length; i++) {
        const altDiff = altitudes[i - 1] - altitudes[i]; // Descending
        const distDiff = (distances[i - 1] - distances[i]) * 1000; // km to m

        if (distDiff > 0) {
            const angle = (Math.atan((altDiff * 0.3048) / distDiff) * 180) / Math.PI; // Convert to degrees
            angles.push(angle);
        }
    }

    const avgAngle = angles.reduce((a, b) => a + b, 0) / angles.length;
    const deviation = Math.sqrt(angles.reduce((sum, angle) => sum + (angle - avgAngle) ** 2, 0) / angles.length);

    // Standard ILS glideslope is 3 degrees
    const isStable = Math.abs(avgAngle - 3) < 0.5 && deviation < 0.3;

    return {
        angle: avgAngle,
        deviation,
        isStable,
    };
}

/**
 * Calculate lateral deviations from runway centerline
 * @private
 */
function calculateLateralDeviations(positions, airport) {
    if (!airport.alignedRunway?.runway) return { avgDeviation: 0, maxDeviation: 0, isStable: true };

    const { runway, heading } = airport.alignedRunway;

    // Get runway center point
    const runwayLat = runway.latitude || airport.latitude_deg;
    const runwayLon = runway.longitude || airport.longitude_deg;

    // Calculate a second point along the runway centerline using the heading
    // Project 10km along the runway heading to create extended centerline
    const extendedPoint = tools.calculateProjectedPosition(
        runwayLat,
        runwayLon,
        10, // 10km extension
        heading
    );

    const deviations = positions.map((pos) => {
        // Calculate cross-track distance from extended runway centerline
        const crossTrack = tools.calculateCrossTrackDistance(pos.lat, pos.lon, runwayLat, runwayLon, extendedPoint.lat, extendedPoint.lon);

        return Math.abs(crossTrack.crossTrackDistance);
    });

    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const maxDeviation = Math.max(...deviations);

    return {
        avgDeviation,
        maxDeviation,
        isStable: maxDeviation < 0.2, // Less than 200m deviation
    };
}

/**
 * Calculate approach stability metrics
 * @private
 */
function calculateApproachStability(aircraftData) {
    const speeds = aircraftData.getField('gs', { maxDataPoints: 15 }).values;
    const tracks = aircraftData.getField('track', { maxDataPoints: 15 }).values;
    const descentRates = aircraftData.getField('baro_rate', { maxDataPoints: 15 }).values;

    // Calculate variations
    const speedVariation = speeds.length > 3 ? Math.max(...speeds) - Math.min(...speeds) : 999;

    const trackVariation = tracks.length > 3 ? Math.max(...tracks) - Math.min(...tracks) : 999;

    const descentVariation = descentRates.length > 3 ? Math.max(...descentRates) - Math.min(...descentRates) : 999;

    const speedStable = speedVariation < 15; // knots
    const trackStable = trackVariation < 10; // degrees
    const descentStable = descentVariation < 300; // fpm

    return {
        speedVariation,
        trackVariation,
        descentVariation,
        speedStable,
        trackStable,
        descentStable,
        isStable: speedStable && trackStable && descentStable,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Analyze wake turbulence separation between aircraft
 * @param {Object} aircraft - Current aircraft
 * @param {Object} airport - Airport object
 * @param {Array} allAircraft - All aircraft in area
 * @returns {Object|undefined} Wake separation analysis
 */
function analyzeWakeSeparation(aircraft, airport, allAircraft) {
    // Add null checks
    if (!airport?.alignedRunway || airport.phase !== 'approaching') return undefined;
    if (!allAircraft || !Array.isArray(allAircraft)) return undefined;

    // Find preceding aircraft on same approach
    const precedingAircraft = findPrecedingAircraft(aircraft, airport, allAircraft);
    if (!precedingAircraft) return undefined;

    // Calculate separation
    const separation = calculateSeparation(aircraft, precedingAircraft.aircraft);

    // Get required separation based on aircraft categories
    const required = aircraftInfo.getRequiredWakeSeparation(precedingAircraft.aircraft.category, aircraft.category);

    // Check if separation is adequate
    const adequate = separation.distance >= required.distance;
    const marginal = separation.distance >= required.distance * 0.8;

    let severity = 'info';
    if (!adequate) severity = 'warning';
    else if (!marginal) severity = 'caution';

    return {
        detected: true,
        precedingAircraft: {
            flight: precedingAircraft.aircraft.flight || precedingAircraft.aircraft.hex,
            category: precedingAircraft.aircraft.category,
            distance: precedingAircraft.distance,
        },
        separation: {
            current: separation.distance,
            required: required.distance,
            timeSeconds: separation.timeSeconds,
        },
        adequate,
        severity,
        reason: required.reason,
    };
}

/**
 * Find aircraft preceding on same approach path
 * @private
 */
function findPrecedingAircraft(aircraft, airport, allAircraft) {
    // Make sure we have valid input
    if (!allAircraft || !Array.isArray(allAircraft)) return undefined;

    const candidates = allAircraft.filter((other) => {
        if (other.hex === aircraft.hex) return false;
        if (!other.calculated?.airports_nearby?.airports) return false;

        const otherAirport = other.calculated.airports_nearby.airports.find((apt) => apt.icao_code === airport.icao_code);

        if (!otherAirport) return false;

        // Must be approaching same runway
        if (otherAirport.phase !== 'approaching') return false;
        if (!otherAirport.alignedRunway) return false;
        if (otherAirport.alignedRunway.runwayName !== airport.alignedRunway.runwayName) return false;

        // Must be ahead (closer to airport)
        return otherAirport.distance < airport.distance;
    });

    // Sort by distance to find immediate predecessor
    candidates.sort((a, b) => {
        const aApt = a.calculated.airports_nearby.airports.find((apt) => apt.icao_code === airport.icao_code);
        const bApt = b.calculated.airports_nearby.airports.find((apt) => apt.icao_code === airport.icao_code);
        // Add null checks
        if (!aApt || !bApt) return 0;
        return bApt.distance - aApt.distance; // Closest to us (largest distance from airport)
    });

    if (candidates.length === 0) return undefined;

    const [preceding] = candidates;
    const precedingAirport = preceding.calculated.airports_nearby.airports.find((apt) => apt.icao_code === airport.icao_code);

    return {
        aircraft: preceding,
        distance: precedingAirport?.distance || 0,
    };
}

/**
 * Calculate separation between two aircraft
 * @private
 */
function calculateSeparation(following, leading) {
    const { distance } = tools.calculateDistance(following.lat, following.lon, leading.lat, leading.lon);

    // Estimate time separation based on speeds
    let timeSeconds;
    if (following.gs && leading.gs) {
        // Simplified: assumes both on same track
        const relativeSpeed = following.gs - leading.gs; // knots
        if (relativeSpeed > 0) {
            timeSeconds = (distance / 1.852 / relativeSpeed) * 3600; // Convert to seconds
        }
    }

    return { distance, timeSeconds };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Detect weather avoidance patterns
 * @param {Object} aircraft - Aircraft object
 * @param {Object} aircraftData - Aircraft trajectory data
 * @param {Object} airport - Airport object
 * @returns {Object|undefined} Weather pattern detection
 */
function detectWeatherAvoidance(aircraft, aircraftData, airport) {
    if (!aircraftData) return undefined;

    const tracks = aircraftData.getField('track', { maxDataPoints: 20 }).values;
    const speeds = aircraftData.getField('gs', { maxDataPoints: 20 }).values;
    const altitudes = aircraftData.getField('calculated.altitude', { maxDataPoints: 20 }).values;

    if (tracks.length < 10) return undefined;

    // Look for weather avoidance patterns
    const patterns = [];

    // 1. Sudden track deviations (avoiding cells)
    const trackChanges = [];
    for (let i = 1; i < tracks.length; i++) {
        const change = helpers.angleDifference(tracks[i], tracks[i - 1]);
        if (Math.abs(change) > 15) {
            trackChanges.push({ index: i, change });
        }
    }

    if (trackChanges.length >= 2) {
        patterns.push({
            type: 'track_deviation',
            severity: trackChanges.some((tc) => Math.abs(tc.change) > 30) ? 'significant' : 'minor',
            count: trackChanges.length,
        });
    }

    // 2. Speed variations (turbulence)
    const speedVar = speeds.length > 3 ? Math.max(...speeds) - Math.min(...speeds) : 0;
    if (speedVar > 30) {
        patterns.push({
            type: 'speed_variation',
            severity: speedVar > 50 ? 'severe' : 'moderate',
            variation: speedVar,
        });
    }

    // 3. Altitude deviations (turbulence or icing)
    const altVar = altitudes.length > 3 ? Math.max(...altitudes) - Math.min(...altitudes) : 0;
    if (altVar > 500 && airport.phase !== 'approaching' && airport.phase !== 'departing') {
        patterns.push({
            type: 'altitude_variation',
            severity: altVar > 1000 ? 'severe' : 'moderate',
            variation: altVar,
        });
    }

    // 4. Holding for weather
    if (airport.holdingPattern && patterns.length > 0) {
        patterns.push({
            type: 'weather_hold',
            severity: 'operational',
            duration: airport.holdingPattern.duration,
        });
    }

    if (patterns.length > 0) {
        return {
            detected: true,
            patterns,
            confidence: Math.min(1, 0.5 + patterns.length * 0.15),
            phase: 'weather_avoidance',
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateRunwayOccupancyTime(aircraft, aircraftData, airport) {
    if (!aircraftData || airport.phase !== 'departing') return undefined;

    const speeds = aircraftData.getField('gs', { maxDataPoints: 10 }).values;
    const altitudes = aircraftData.getField('calculated.altitude', { maxDataPoints: 10 }).values;

    // Find when aircraft started moving (speed > 30 knots)
    let startIndex = -1;
    for (let i = 0; i < speeds.length - 1; i++) {
        if (speeds[i] < 30 && speeds[i + 1] >= 30) {
            startIndex = i;
            break;
        }
    }

    // Find when aircraft lifted off (altitude increase)
    let liftoffIndex = -1;
    for (let i = 1; i < altitudes.length; i++) {
        if (altitudes[i] > altitudes[i - 1] + 50) {
            // 50ft climb
            liftoffIndex = i;
            break;
        }
    }

    if (startIndex >= 0 && liftoffIndex > startIndex) {
        // Estimate time based on data point intervals
        const occupancyTime = (liftoffIndex - startIndex) * 4; // Assuming 4 second updates
        return occupancyTime;
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Get appropriate runway alignment detection distance based on aircraft
 * @param {Object} aircraft - Aircraft object
 * @param {Object} conf - Configuration object
 * @returns {number} Distance in km
 */
function getRunwayAlignmentDistance(aircraft, runwayAlignmentDistance) {
    if (typeof runwayAlignmentDistance === 'number') {
        // Simple numeric override
        return runwayAlignmentDistance;
    }

    // Category-based distance
    const distances = runwayAlignmentDistance || {};
    return distances[aircraft.category] || distances.default || 20;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Determine if runway alignment should be checked for this aircraft/airport
 * @param {Object} aircraft - Aircraft object
 * @param {Object} airport - Airport object
 * @param {number} maxDistance - Maximum distance to check
 * @returns {boolean}
 */
function shouldCheckRunwayAlignment(aircraft, airport, maxDistance) {
    // Don't check if too far
    if (airport.distance > maxDistance) return false;

    // Don't check if too high
    if (aircraft.calculated?.altitude > 10000) return false;

    // Check if aircraft is in a phase where alignment matters
    if (aircraft.calculated?.altitude < 5000) return true;

    // Check if descending/climbing and within extended range
    if (aircraft.baro_rate && Math.abs(aircraft.baro_rate) > 500 && airport.distance < maxDistance) {
        return true;
    }

    return false;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    detectGoAround,
    detectHoldingPattern,
    detectQueuePosition,
    detectTrafficPattern,
    detectOverheadJoin,
    detectTouchAndGo,
    detectRunwayChange,
    areRunwaysOpposite,
    detectMissedApproach,
    detectApproachType,
    calculateGlideslope,
    calculateLateralDeviations,
    calculateApproachStability,
    analyzeWakeSeparation,
    findPrecedingAircraft,
    calculateSeparation,
    detectWeatherAvoidance,
    //
    calculateRunwayOccupancyTime,
    getRunwayAlignmentDistance,
    shouldCheckRunwayAlignment,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
