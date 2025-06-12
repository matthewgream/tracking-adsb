// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };
//const aircraft_info = require('./aircraft-info.js');

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

function getMinRunwayLength(aircraftCategory) {
    // This should eventually be moved to aircraft-info.js as part of category info
    const minRunwayLengths = {
        A0: 3000, // Unknown - use conservative default
        A1: 1000, // Light aircraft can use short strips
        A2: 2500, // Small aircraft need moderate runways
        A3: 5000, // Large aircraft need substantial runways
        A4: 6000, // B757 needs good runways
        A5: 8000, // Heavy aircraft need long runways
        A6: 4000, // High performance military
        A7: 0, // Helicopters don't need runways
        B1: 1500, // Gliders need some runway
        B2: 0, // Balloons don't need runways
        B3: 0, // Parachutists don't need runways
        B4: 800, // Ultralights can use very short strips
        B6: 500, // Small UAVs
    };

    return minRunwayLengths[aircraftCategory] || 3000; // Conservative default
}

/**
 * Determine if aircraft is at typical airport operation speed
 * Different aircraft categories have different approach/departure speeds
 * @param {Object} aircraft - Aircraft object with gs and category
 * @returns {boolean} True if aircraft is at airport operation speed
 */
function isAircraftAtAirportSpeed(aircraft) {
    if (!aircraft.gs) return false;

    // Define typical airport operation speeds by category (in knots)
    const airportSpeeds = {
        A1: { min: 50, max: 150 }, // Light aircraft
        A2: { min: 80, max: 200 }, // Small aircraft
        A3: { min: 120, max: 250 }, // Large aircraft
        A4: { min: 120, max: 250 }, // B757
        A5: { min: 130, max: 280 }, // Heavy aircraft
        A6: { min: 150, max: 350 }, // High performance
        A7: { min: 0, max: 150 }, // Helicopters (can hover)
        B1: { min: 40, max: 100 }, // Gliders
        B4: { min: 30, max: 80 }, // Ultralights
        B6: { min: 20, max: 100 }, // UAVs
    };

    const speeds = airportSpeeds[aircraft.category] || { min: 60, max: 250 }; // Default
    return aircraft.gs >= speeds.min && aircraft.gs <= speeds.max;
}

/**
 * Determine if aircraft is at typical airport operation altitude
 * @param {Object} aircraft - Aircraft object with altitude and category
 * @returns {boolean} True if aircraft is at airport operation altitude
 */
function isAircraftAtAirportAltitude(aircraft) {
    if (!aircraft.calculated?.altitude) return false;

    // Different categories might have different pattern altitudes
    const maxAltitudes = {
        A1: 3000, // Light aircraft typically fly lower patterns
        A2: 4000, // Small aircraft
        A3: 5000, // Large aircraft
        A4: 5000, // B757
        A5: 6000, // Heavy aircraft might be higher on approach
        A7: 2000, // Helicopters typically lower
        B1: 3000, // Gliders
        B4: 1500, // Ultralights very low
        B6: 2000, // Small UAVs
    };

    const maxAlt = maxAltitudes[aircraft.category] || 5000; // Default
    return aircraft.calculated.altitude <= maxAlt;
}

/**
 * Calculate compatibility factor between airport size and aircraft category
 * @param {Object} airport - Airport object with runways, iata_code, type
 * @param {Object} aircraft - Aircraft object with category
 * @returns {number} Compatibility factor (0-1)
 */
function calculateAirportSizeCompatibilityFactor(airport, aircraft) {
    const hasIATA = airport.iata_code && airport.iata_code.trim() !== '';
    const runwayLength = airport.runwayLengthMax || airport.runways?.reduce((max, runway) => Math.max(runway.length_ft || 0, max), 0) || 0;

    // Base size score for airport
    let airportSizeScore = 0;
    if (runwayLength > 8000)
        airportSizeScore = 1; // Major airport
    else if (runwayLength > 5000)
        airportSizeScore = 0.7; // Medium airport
    else if (runwayLength > 3000)
        airportSizeScore = 0.4; // Small airport
    else if (hasIATA)
        airportSizeScore = 0.5; // Has IATA but unknown runway
    else airportSizeScore = 0.2; // Very small/unknown

    // Match aircraft category to airport size
    let compatibilityMultiplier = 1;

    switch (aircraft.category) {
        case 'A5': // Heavy aircraft
        case 'A4': // B757
            // Heavy aircraft prefer major airports
            if (airportSizeScore < 0.7) compatibilityMultiplier = 0.3;
            else if (airportSizeScore >= 1) compatibilityMultiplier = 1.2;
            break;

        case 'A3': // Large aircraft
            // Large aircraft need medium+ airports
            if (airportSizeScore < 0.4) compatibilityMultiplier = 0.4;
            else if (airportSizeScore >= 0.7) compatibilityMultiplier = 1.1;
            break;

        case 'A2': // Small aircraft
            // Small aircraft are flexible but still prefer larger airports
            if (airportSizeScore < 0.2) compatibilityMultiplier = 0.6;
            // eslint-disable-next-line sonarjs/no-redundant-assignments
            else if (airportSizeScore >= 0.4) compatibilityMultiplier = 1;
            break;

        case 'A1': // Light aircraft
        case 'B4': // Ultralight
            // Light aircraft can use any airport, but might prefer smaller ones
            if (airportSizeScore <= 0.4) compatibilityMultiplier = 1.1;
            else if (airportSizeScore >= 1) compatibilityMultiplier = 0.8;
            break;

        case 'A7': // Helicopters
            // Helicopters can use any airport but also heliports
            // eslint-disable-next-line unicorn/prefer-ternary
            if (airport.type === 'heliport') compatibilityMultiplier = 1.5;
            else compatibilityMultiplier = 0.9;
            break;

        case 'B1': // Gliders
            // Gliders prefer specific airports
            if (airport.type === 'gliderport' || runwayLength < 3000) compatibilityMultiplier = 1.2;
            break;

        default:
            // Unknown category - neutral
            compatibilityMultiplier = 0.8;
    }

    return airportSizeScore * compatibilityMultiplier;
}

function isAirportCompatibleWithAircraft(airport, aircraft) {
    // Special airport types
    if (airport.type === 'heliport' && aircraft.category !== 'A7') return false;
    if (airport.type === 'balloonport' && aircraft.category !== 'B2') return false;
    if (airport.type === 'seaplane_base' && !['A1', 'A2'].includes(aircraft.category)) return false;

    // Check runway length compatibility
    const requiredLength = getMinRunwayLength(aircraft.category || 'A0');
    const runwayLengthMax = airport.runwayLengthMax || airport.runways?.reduce((max, runway) => Math.max(runway.length_ft || 0, max), 0) || 0;

    // Small airstrips (no IATA code) are unlikely for large aircraft
    const hasIATA = airport.iata_code && airport.iata_code.trim() !== '';

    // If no runway data, use IATA as proxy (airports with IATA codes are generally larger)
    if (!runwayLengthMax && requiredLength > 2000 && !hasIATA) {
        return false; // Likely a small strip, not suitable for larger aircraft
    }

    if (runwayLengthMax && runwayLengthMax < requiredLength) {
        return false;
    }

    return true;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function findAlignedRunwayWithScore(airport, aircraft, aircraftData = undefined) {
    if (!airport.runways || airport.runways.length === 0) return undefined;

    const results = [];

    // Get more trajectory data for aircraft far from airport
    const trajectoryPoints = airport.distance > 10 ? 20 : 10; // More points for longer approaches

    // Get trajectory data if available
    const trajectoryTracks = aircraftData ? aircraftData.getField('track', { maxDataPoints: trajectoryPoints }).values : [aircraft.track].filter(Boolean);

    if (trajectoryTracks.length === 0) return undefined;

    // Analyze each runway
    for (const runway of airport.runways) {
        if (!runway.le_heading_degT) continue;

        // Check both runway directions
        const runwayDirections = [
            { heading: runway.le_heading_degT, ident: runway.le_ident },
            { heading: tools.normalizeDegrees(runway.le_heading_degT + 180), ident: runway.he_ident },
        ];

        for (const direction of runwayDirections) {
            let alignmentScore = 0;
            let totalWeight = 0;
            const alignments = [];

            // Score alignment for each track point, with more recent points weighted higher
            trajectoryTracks.forEach((track, index) => {
                const weight = (index + 1) / trajectoryTracks.length; // Recent tracks weighted more
                const headingDiff = Math.abs(tools.angleDifference(track, direction.heading));

                // Convert heading difference to alignment score (0-1)
                const alignmentValue = Math.max(0, 1 - headingDiff / 45); // 45 degrees = 0 score
                alignmentScore += alignmentValue * weight;
                totalWeight += weight;

                alignments.push({
                    track,
                    headingDiff,
                    alignmentValue,
                    weight,
                });
            });

            alignmentScore = totalWeight > 0 ? alignmentScore / totalWeight : 0;
            const currentAlignment = Math.abs(tools.angleDifference(aircraft.track, direction.heading));

            // Additional scoring factors
            let confidenceScore = alignmentScore;

            // Boost confidence if trajectory is consistent
            if (trajectoryTracks.length > 3) {
                const trackVariance = tools.calculateVariance(trajectoryTracks);
                if (trackVariance < 10) {
                    // Very stable track
                    confidenceScore *= 1.2;
                } else if (trackVariance > 30) {
                    // Unstable track
                    confidenceScore *= 0.8;
                }
            }

            // Consider altitude for approach/departure phase
            if (aircraft.calculated?.altitude) {
                if (aircraft.calculated.altitude < 3000) {
                    confidenceScore *= 1.1; // Low altitude increases confidence
                } else if (aircraft.calculated.altitude > 10000) {
                    confidenceScore *= 0.7; // High altitude decreases confidence
                }
            }

            // Normalize confidence to 0-1 range
            confidenceScore = Math.min(1, Math.max(0, confidenceScore));

            if (alignmentScore > 0.3) {
                // Minimum threshold for consideration
                results.push({
                    runway,
                    heading: direction.heading,
                    runwayName: direction.ident,
                    currentAlignment,
                    alignmentScore,
                    confidenceScore,
                    trajectoryPoints: trajectoryTracks.length,
                    alignments,
                    isGoodAlignment: alignmentScore > 0.7,
                    isModerateAlignment: alignmentScore > 0.5 && alignmentScore <= 0.7,
                    isPoorAlignment: alignmentScore <= 0.5,
                });
            }
        }
    }

    // Sort by confidence score and return best match
    results.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return results.length > 0 ? results[0] : undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Get relevant squawk codes for a specific airport
 * This is a framework that can be expanded with airport-specific data
 * @param {Object} airport - Airport object with icao_code
 * @returns {Array<string>} Array of squawk codes relevant to this airport
 */
function getSquawksForAirport(airport) {
    // Base VFR codes used at most airports
    const baseVFRCodes = ['1200', '7000']; // US and Europe VFR

    // Pattern/training codes
    const patternCodes = ['1201', '1202', '1203', '1204', '1205', '1206'];

    // Special airport-specific codes (can be expanded with data)
    const airportSpecificCodes = {
        // UK specific
        EGLL: ['1177', '1277'], // London Heathrow special codes
        EGKK: ['1177'], // Gatwick
        EGLC: ['1177'], // London City

        // Add more airport-specific codes as needed
        // This could eventually be loaded from a data file
    };

    // Combine all relevant codes
    let codes = [...baseVFRCodes, ...patternCodes];

    // Add airport-specific codes if available
    if (airport.icao_code && airportSpecificCodes[airport.icao_code]) {
        codes = [...codes, ...airportSpecificCodes[airport.icao_code]];
    }

    // Add regional VFR codes based on airport country
    const countryCode = airport.icao_code ? airport.icao_code.slice(0, 2) : '';
    const regionalVFRCodes = {
        EG: ['7000', '1177'], // UK
        EI: ['7000'], // Ireland
        LF: ['7000'], // France
        ED: ['7000'], // Germany
        K: ['1200'], // USA (single letter)
        C: ['1200'], // Canada
    };

    if (regionalVFRCodes[countryCode] || regionalVFRCodes[countryCode.slice(0, 1)]) {
        const regional = regionalVFRCodes[countryCode] || regionalVFRCodes[countryCode.slice(0, 1)];
        codes = [...codes, ...regional];
    }

    // Remove duplicates
    return [...new Set(codes)];
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Check if a squawk code indicates airport operations
 * @param {string} squawk - Squawk code
 * @param {string} region - Optional region code (e.g., 'US', 'EU')
 * @returns {boolean} True if squawk indicates airport operations
 */
function isAirportOperationsSquawk(squawk, region = undefined) {
    if (!squawk) return false;

    // VFR codes by region
    const vfrCodes = {
        US: ['1200'],
        EU: ['7000'],
        UK: ['7000', '1177'],
    };

    // Pattern work codes (mostly US)
    const patternCodes = ['1201', '1202', '1203', '1204', '1205', '1206', '1277'];

    // Check if it's a VFR code
    if (region && vfrCodes[region] && vfrCodes[region].includes(squawk)) {
        return true;
    }

    // Check all VFR codes if no region specified
    if (!region) {
        for (const codes of Object.values(vfrCodes)) {
            if (codes.includes(squawk)) return true;
        }
    }

    // Check pattern codes
    return patternCodes.includes(squawk);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const FORMATION_THRESHOLDS = {
    trackDifference: 5, // degrees
    speedDifference: 10, // knots
    climbRateDifference: 200, // fpm
    altitudeDifference: 500, // feet for close formation
};

/**
 * Detect if two aircraft are likely flying in formation
 * @param {Object} aircraft1 - First aircraft
 * @param {Object} aircraft2 - Second aircraft
 * @param {Object} options - Optional thresholds
 * @returns {Object} Formation detection result with confidence
 */
function isLikelyFormation(aircraft1, aircraft2, options = {}) {
    const thresholds = { ...FORMATION_THRESHOLDS, ...options };
    const factors = [];

    // Track alignment check
    if (aircraft1.track !== undefined && aircraft2.track !== undefined) {
        const trackDiff = Math.abs(aircraft1.track - aircraft2.track);
        const normalizedDiff = trackDiff > 180 ? 360 - trackDiff : trackDiff;

        if (normalizedDiff <= thresholds.trackDifference) {
            factors.push({ factor: 'track', match: true, diff: normalizedDiff });
        } else {
            factors.push({ factor: 'track', match: false, diff: normalizedDiff });
        }
    }

    // Speed matching check
    if (aircraft1.gs !== undefined && aircraft2.gs !== undefined) {
        const speedDiff = Math.abs(aircraft1.gs - aircraft2.gs);

        if (speedDiff <= thresholds.speedDifference) {
            factors.push({ factor: 'speed', match: true, diff: speedDiff });
        } else {
            factors.push({ factor: 'speed', match: false, diff: speedDiff });
        }
    }

    // Climb rate matching check
    if (aircraft1.baro_rate !== undefined && aircraft2.baro_rate !== undefined) {
        const climbDiff = Math.abs(aircraft1.baro_rate - aircraft2.baro_rate);

        if (climbDiff <= thresholds.climbRateDifference) {
            factors.push({ factor: 'climbRate', match: true, diff: climbDiff });
        } else {
            factors.push({ factor: 'climbRate', match: false, diff: climbDiff });
        }
    }

    // Altitude consistency check
    if (aircraft1.calculated?.altitude !== undefined && aircraft2.calculated?.altitude !== undefined) {
        const altDiff = Math.abs(aircraft1.calculated.altitude - aircraft2.calculated.altitude);

        if (altDiff <= thresholds.altitudeDifference) {
            factors.push({ factor: 'altitude', match: true, diff: altDiff });
        } else {
            factors.push({ factor: 'altitude', match: false, diff: altDiff });
        }
    }

    // Calculate confidence based on matching factors
    const matchingFactors = factors.filter((f) => f.match).length;
    const totalFactors = factors.length;

    if (totalFactors === 0) {
        return { isFormation: false, confidence: 0, factors: [] };
    }

    const confidence = matchingFactors / totalFactors;
    const isFormation = matchingFactors >= 3 && confidence >= 0.75;

    return {
        isFormation,
        confidence,
        factors,
        matchingFactors,
        totalFactors,
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
    // NEW
    getMinRunwayLength,
    isAirportCompatibleWithAircraft,
    findAlignedRunwayWithScore,
    isAircraftAtAirportSpeed,
    isAircraftAtAirportAltitude,
    getSquawksForAirport,
    isAirportOperationsSquawk,
    calculateAirportSizeCompatibilityFactor,
    //
    isLikelyFormation,
    FORMATION_THRESHOLDS,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
