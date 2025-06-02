// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// Configuration with sensible defaults
const LOITERING_CONFIG = {
    // Stage 1: Quick filters
    maxAltitude: 5000, // ft - loitering typically happens at lower altitudes
    minGroundSpeed: 10, // kts - must be moving (not parked)
    maxGroundSpeed: 150, // kts - loitering aircraft move slowly

    // Aircraft type configuration
    categoryFiltering: {
        enabled: true,
        // Explicitly include these categories (high loitering probability)
        include: [
            'A7', // Rotorcraft - often loiter for various operations
            'B1', // Gliders - thermal soaring looks like loitering
            'B6', // UAV/Drone - surveillance, monitoring
            'C1', // Emergency vehicles (though rarely airborne)
        ],
        // Explicitly exclude these categories (low loitering probability)
        exclude: [
            'A4', // B757 - doesn't loiter
            'A5', // Heavy aircraft - too expensive to loiter
            'B7', // Space vehicles
            'C2', // Surface vehicles
        ],
        // Categories not in include/exclude are evaluated normally
    },

    // Stage 2: Trajectory analysis
    trajectory: {
        minDataPoints: 10, // Need sufficient history
        maxTimeWindow: 10 * 60 * 1000, // 10 minutes in ms
        minTimeWindow: 3 * 60 * 1000, // 3 minutes minimum
        minTotalDistance: 0.5, // km - must have moved at least this much
        maxBoundingBox: 10, // km - maximum area diagonal
        minBoundingBox: 0.2, // km - minimum area to avoid stationary
    },

    // Stage 3: Pattern detection
    patterns: {
        // Circling detection
        circling: {
            minHeadingChanges: 3, // Minimum direction changes
            headingChangeThreshold: 30, // degrees
            minTotalHeadingChange: 540, // 1.5 circles minimum
        },
        // Figure-8 or racetrack pattern
        reversingTrack: {
            minReversals: 2,
            reversalThreshold: 150, // degrees
        },
        // Hovering (for rotorcraft)
        hovering: {
            maxSpeedVariation: 30, // kts
            maxPositionVariation: 0.5, // km
        },
    },

    // Scoring thresholds
    scoring: {
        minScore: 0.7, // Minimum score to consider loitering
        weights: {
            boundingBoxRatio: 0.3, // How confined the area is
            patternMatch: 0.4, // Pattern detection weight
            consistentAltitude: 0.2, // Altitude stability
            aircraftType: 0.1, // Aircraft type bonus
        },
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function quickFilterCheck(config, aircraft) {
    // 1. Altitude check
    if (!aircraft.calculated?.altitude || aircraft.calculated.altitude > config.maxAltitude) return { pass: false, reason: 'altitude' };
    // 2. Speed check
    if (!aircraft.gs || aircraft.gs < config.minGroundSpeed || aircraft.gs > config.maxGroundSpeed) return { pass: false, reason: 'speed' };
    // 3. Must have trajectory data
    if (!aircraft.calculated?.trajectoryData || aircraft.calculated.trajectoryData.length < config.trajectory.minDataPoints)
        return { pass: false, reason: 'insufficient_data' };
    // 4. Category filtering
    if (config.categoryFiltering.enabled && aircraft.category) {
        if (config.categoryFiltering.include.includes(aircraft.category)) return { pass: true, categoryBonus: 0.2 }; // Bonus for expected types
        if (config.categoryFiltering.exclude.includes(aircraft.category)) return { pass: false, reason: 'category_excluded' };
    }
    return { pass: true };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function analyzeBoundingBox(trajectoryData, config) {
    const now = Date.now();
    const cutoffTime = now - config.trajectory.maxTimeWindow;
    const positions = trajectoryData
        .filter((entry) => entry.timestamp >= cutoffTime && entry.snapshot.lat !== undefined && entry.snapshot.lon !== undefined)
        .map((entry) => ({
            lat: entry.snapshot.lat,
            lon: entry.snapshot.lon,
            timestamp: entry.timestamp,
            altitude: entry.snapshot.calculated?.altitude || entry.snapshot.alt_baro,
            track: entry.snapshot.track,
            gs: entry.snapshot.gs,
        }));
    if (positions.length < config.trajectory.minDataPoints) return { pass: false, reason: 'insufficient_positions' };
    const lats = positions.map((p) => p.lat),
        lons = positions.map((p) => p.lon);
    const minLat = Math.min(...lats),
        maxLat = Math.max(...lats),
        minLon = Math.min(...lons),
        maxLon = Math.max(...lons);
    const diagonal = helpers.calculateDistance(minLat, minLon, maxLat, maxLon);
    if (diagonal > config.trajectory.maxBoundingBox) return { pass: false, reason: 'area_too_large', diagonal };
    if (diagonal < config.trajectory.minBoundingBox) return { pass: false, reason: 'not_moving_enough', diagonal };
    let totalDistance = 0;
    for (let i = 1; i < positions.length; i++)
        totalDistance += helpers.calculateDistance(positions[i - 1].lat, positions[i - 1].lon, positions[i].lat, positions[i].lon);
    if (totalDistance < config.trajectory.minTotalDistance) return { pass: false, reason: 'insufficient_movement', totalDistance };
    const centerLat = (minLat + maxLat) / 2,
        centerLon = (minLon + maxLon) / 2;
    const distances = positions.map((p) => helpers.calculateDistance(centerLat, centerLon, p.lat, p.lon));
    const radius = distances.reduce((a, b) => a + b, 0) / distances.length;
    return {
        pass: true,
        boundingBox: {
            minLat,
            maxLat,
            minLon,
            maxLon,
            diagonal,
            center: { lat: centerLat, lon: centerLon },
            radius,
        },
        positions,
        totalDistance,
        timeSpan: positions[positions.length - 1].timestamp - positions[0].timestamp,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectCirclingPattern(positions, config) {
    if (positions.length < 5) return { detected: false };
    let headingChanges = 0,
        totalHeadingChange = 0,
        lastSignificantTrack = positions[0].track;
    for (let i = 1; i < positions.length; i++) {
        if (!positions[i].track || !lastSignificantTrack) continue;
        let change = positions[i].track - lastSignificantTrack;
        if (change > 180) change -= 360;
        if (change < -180) change += 360;
        if (Math.abs(change) > config.patterns.circling.headingChangeThreshold) {
            headingChanges++;
            totalHeadingChange += change;
            lastSignificantTrack = positions[i].track;
        }
    }
    const detected =
        headingChanges >= config.patterns.circling.minHeadingChanges && Math.abs(totalHeadingChange) >= config.patterns.circling.minTotalHeadingChange;
    return {
        detected,
        headingChanges,
        totalHeadingChange: Math.abs(totalHeadingChange),
        confidence: detected ? Math.min(1, Math.abs(totalHeadingChange) / 720) : 0, // 720° = 2 full circles
    };
}

function detectReversingPattern(positions, config) {
    if (positions.length < 5) return { detected: false };
    let reversals = 0,
        lastTrack = positions[0].track;
    for (let i = 1; i < positions.length; i++) {
        if (!positions[i].track || !lastTrack) continue;
        let change = Math.abs(positions[i].track - lastTrack);
        if (change > 180) change = 360 - change;
        if (change > config.patterns.reversingTrack.reversalThreshold) reversals++;
        lastTrack = positions[i].track;
    }
    const detected = reversals >= config.patterns.reversingTrack.minReversals;
    return {
        detected,
        reversals,
        confidence: detected ? Math.min(1, reversals / 4) : 0,
    };
}

function detectHoveringPattern(positions, config, aircraftCategory) {
    if (aircraftCategory !== 'A7') return { detected: false };
    const speeds = positions.map((p) => p.gs).filter((s) => s !== undefined);
    const lats = positions.map((p) => p.lat),
        lons = positions.map((p) => p.lon);
    if (speeds.length < 5) return { detected: false };
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length,
        maxSpeed = Math.max(...speeds),
        minSpeed = Math.min(...speeds);
    const speedVariation = maxSpeed - minSpeed;
    const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length,
        centerLon = lons.reduce((a, b) => a + b, 0) / lons.length;
    const positionVariation = Math.max(...positions.map((p) => helpers.calculateDistance(centerLat, centerLon, p.lat, p.lon)));
    const detected =
        speedVariation <= config.patterns.hovering.maxSpeedVariation && positionVariation <= config.patterns.hovering.maxPositionVariation && avgSpeed < 50; // Hovering typically < 50 kts
    return {
        detected,
        avgSpeed,
        speedVariation,
        positionVariation,
        confidence: detected ? 0.8 : 0,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLoiteringScore(analysis, patterns, config, categoryBonus = 0) {
    const { boundingBox, timeSpan, positions } = analysis;
    const { weights } = config.scoring;
    // 1. Bounding box score (tighter = higher score)
    const expectedDistance = (timeSpan / 1000 / 60) * 2, // km at 120 kts for time period
        boundingBoxScore = Math.max(0, 1 - boundingBox.diagonal / expectedDistance);
    // 2. Pattern matching score
    const patternScores = [patterns.circling.confidence, patterns.reversing.confidence, patterns.hovering.confidence],
        patternLabels = ['circling', 'reversing', 'hovering'],
        patternScore = Math.max(...patternScores);
    // 3. Altitude consistency (from bounding box positions)
    const altitudes = positions.map((p) => p.altitude).filter((a) => a !== undefined);
    if (altitudes.length > 0) {
        const altitudeVariation = Math.max(...altitudes) - Math.min(...altitudes);
        const altitudeScore = Math.max(0, 1 - altitudeVariation / 1000); // 1000 ft variation = 0 score
        // 4. Calculate weighted score
        const score =
            boundingBoxScore * weights.boundingBoxRatio +
            patternScore * weights.patternMatch +
            altitudeScore * weights.consistentAltitude +
            categoryBonus * weights.aircraftType;
        return {
            score: Math.min(1, score),
            components: {
                boundingBox: boundingBoxScore,
                pattern: patternScore,
                altitude: altitudeScore,
                category: categoryBonus,
            },
            primaryPattern: patternLabels?.[patternScores.indexOf(patternScore)] || 'unknown',
        };
    }
    return { score: 0, components: {} };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectLoitering(config, aircraft) {
    // Stage 1: Quick filters
    const quickCheck = quickFilterCheck(config, aircraft);
    if (!quickCheck.pass) return { isLoitering: false, stage: 1, reason: quickCheck.reason };
    // Stage 2: Bounding box analysis
    const boundingAnalysis = analyzeBoundingBox(aircraft.calculated.trajectoryData, config);
    if (!boundingAnalysis.pass) return { isLoitering: false, stage: 2, reason: boundingAnalysis.reason };
    // Stage 3: Pattern detection
    const patterns = {
        circling: detectCirclingPattern(boundingAnalysis.positions, config),
        reversing: detectReversingPattern(boundingAnalysis.positions, config),
        hovering: detectHoveringPattern(boundingAnalysis.positions, config, aircraft.category),
    };
    // Stage 4: Calculate final score
    const scoring = calculateLoiteringScore(boundingAnalysis, patterns, config, quickCheck.categoryBonus || 0);
    if (scoring.score >= config.scoring.minScore)
        return {
            isLoitering: true,
            score: scoring.score,
            loiteringCenter: boundingAnalysis.boundingBox.center,
            loiteringRadius: boundingAnalysis.boundingBox.radius,
            pattern: scoring.primaryPattern,
            duration: Math.round(boundingAnalysis.timeSpan / 1000 / 60), // minutes
            area: boundingAnalysis.boundingBox.diagonal,
            details: {
                scoring: scoring.components,
                patterns,
                boundingBox: boundingAnalysis.boundingBox,
            },
        };
    return {
        isLoitering: false,
        stage: 4,
        score: scoring.score,
        reason: 'below_threshold',
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'loitering',
    name: 'Aircraft loitering detection',
    priority: 4, // Same as anomaly detection
    config: (conf, extra) => {
        this.conf = { ...LOITERING_CONFIG, ...conf };
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.loitering = { isLoitering: false };
        const loitering = detectLoitering(this.conf, aircraft);
        if (loitering) aircraft.calculated.loitering = loitering;
    },
    evaluate: (aircraft) => aircraft.calculated.loitering.isLoitering,
    sort: (a, b) => {
        const a_ = a.calculated.loitering,
            b_ = b.calculated.loitering;
        if (a_.score !== b_.score) return b_.score - a_.score;
        return b_.duration - a_.duration;
    },
    getStats: (aircrafts, list) => {
        const byPattern = list
            .map((a) => a.calculated.loitering.pattern)
            .reduce((counts, pattern) => ({ ...counts, [pattern]: (counts[pattern] || 0) + 1 }), {});
        const byCategory = list
            .filter((a) => a.category)
            .map((a) => a.category)
            .reduce((counts, cat) => ({ ...counts, [cat]: (counts[cat] || 0) + 1 }), {});
        return {
            total: list.length,
            byPattern,
            byCategory,
            avgDuration: list.reduce((sum, a) => sum + a.calculated.loitering.duration, 0) / list.length,
            avgScore: list.reduce((sum, a) => sum + a.calculated.loitering.score, 0) / list.length,
        };
    },
    format: (aircraft) => {
        const { loitering } = aircraft.calculated;
        const { lat, lon } = loitering.loiteringCenter;
        const position = this.extra.format.formatAirport(this.extra.data.airports.findNearby(lat, lon, { distance: 5 })[0]);
        const locationText = position || `${loitering.loiteringRadius.toFixed(1)}km radius`;
        const scorePercent = Math.round(loitering.score * 100);
        return {
            text: `loitering (${loitering.pattern}) near ${locationText} for ${loitering.duration}min [${scorePercent}%]`,
            warn: loitering.score > 0.85 || loitering.duration > 15,
            loiteringInfo: {
                center: loitering.loiteringCenter,
                radius: loitering.loiteringRadius,
                pattern: loitering.pattern,
                duration: loitering.duration,
                score: loitering.score,
            },
        };
    },
    debug: (type, aircraft) => {
        const { loitering } = aircraft.calculated;
        if (type == 'sorting') return `score=${loitering.score.toFixed(2)}, duration=${loitering.duration}min`;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
