// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// Performance expectations by aircraft category
const PERFORMANCE_PROFILES = {
    // A1: Light aircraft (<15.5k lbs)
    A1: {
        climb: {
            initial: { min: 300, typical: 700, max: 1200 }, // ft/min
            cruise: { min: 100, typical: 300, max: 500 },
        },
        cruise: {
            // Speed ranges by altitude band
            low: { min: 70, typical: 120, max: 180 }, // 0-10k ft
            medium: { min: 90, typical: 140, max: 200 }, // 10k-20k ft
            high: { min: 100, typical: 160, max: 220 }, // 20k+ ft
        },
        descent: {
            normal: { min: -300, typical: -500, max: -1500 },
            approach: { min: -300, typical: -700, max: -1000 },
        },
        ceiling: 20000, // typical service ceiling
    },

    // A2: Small aircraft (15.5-75k lbs)
    A2: {
        climb: {
            initial: { min: 500, typical: 1500, max: 3000 }, // Increased max
            cruise: { min: 200, typical: 500, max: 1200 },
        },
        cruise: {
            low: { min: 150, typical: 250, max: 300 },
            medium: { min: 200, typical: 280, max: 350 },
            high: { min: 250, typical: 320, max: 400 },
        },
        descent: {
            normal: { min: -500, typical: -1000, max: -3000 },
            approach: { min: -400, typical: -800, max: -1500 },
        },
        ceiling: 37000,
    },

    // A3: Large aircraft (75-300k lbs)
    A3: {
        climb: {
            initial: { min: 800, typical: 2500, max: 4500 }, // Much more realistic
            cruise: { min: 200, typical: 500, max: 1500 }, // Higher max for step climbs
        },
        cruise: {
            low: { min: 180, typical: 300, max: 400 },
            medium: { min: 250, typical: 380, max: 480 },
            high: { min: 380, typical: 480, max: 560 }, // Lower min for high altitude
        },
        descent: {
            normal: { min: -500, typical: -1800, max: -4000 }, // Wider range
            approach: { min: -400, typical: -800, max: -1500 },
        },
        ceiling: 43000, // More realistic
    },

    // A4: B757 (special category)
    A4: {
        climb: {
            initial: { min: 1200, typical: 2800, max: 5000 }, // B757 has excellent climb
            cruise: { min: 300, typical: 600, max: 1500 },
        },
        cruise: {
            low: { min: 200, typical: 300, max: 400 },
            medium: { min: 300, typical: 400, max: 480 },
            high: { min: 400, typical: 490, max: 560 },
        },
        descent: {
            normal: { min: -500, typical: -2000, max: -4500 },
            approach: { min: -400, typical: -800, max: -1500 },
        },
        ceiling: 42000,
    },

    // A5: Heavy aircraft (>300k lbs)
    A5: {
        climb: {
            initial: { min: 600, typical: 1800, max: 3500 }, // More realistic for heavies
            cruise: { min: 150, typical: 400, max: 1000 },
        },
        cruise: {
            low: { min: 200, typical: 320, max: 400 },
            medium: { min: 320, typical: 420, max: 500 },
            high: { min: 420, typical: 490, max: 580 },
        },
        descent: {
            normal: { min: -400, typical: -1500, max: -3500 },
            approach: { min: -300, typical: -700, max: -1200 },
        },
        ceiling: 45000, // Some heavies can go higher
    },

    // A7: Rotorcraft
    A7: {
        climb: {
            initial: { min: 200, typical: 700, max: 1500 },
            cruise: { min: 100, typical: 300, max: 500 },
        },
        cruise: {
            low: { min: 20, typical: 100, max: 150 },
            medium: { min: 50, typical: 120, max: 170 },
            high: { min: 80, typical: 140, max: 180 },
        },
        descent: {
            normal: { min: -300, typical: -500, max: -1500 },
            approach: { min: -200, typical: -500, max: -800 },
        },
        ceiling: 15000,
    },

    // B1: Glider
    B1: {
        climb: {
            initial: { min: -200, typical: 200, max: 1000 }, // Can thermal
            cruise: { min: -100, typical: 0, max: 500 },
        },
        cruise: {
            low: { min: 40, typical: 60, max: 100 },
            medium: { min: 50, typical: 70, max: 120 },
            high: { min: 60, typical: 80, max: 140 },
        },
        descent: {
            normal: { min: -100, typical: -200, max: -500 },
            approach: { min: -100, typical: -300, max: -500 },
        },
        ceiling: 25000,
    },

    // B6: UAV/Drone
    B6: {
        climb: {
            initial: { min: 100, typical: 300, max: 800 },
            cruise: { min: 50, typical: 150, max: 300 },
        },
        cruise: {
            low: { min: 30, typical: 60, max: 100 },
            medium: { min: 40, typical: 80, max: 120 },
            high: { min: 50, typical: 100, max: 150 },
        },
        descent: {
            normal: { min: -200, typical: -300, max: -800 },
            approach: { min: -100, typical: -200, max: -400 },
        },
        ceiling: 20000,
    },
};

// Default profile for unknown categories
const DEFAULT_PROFILE = PERFORMANCE_PROFILES.A2;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectFlightPhase(aircraft, trajectoryData) {
    if (!aircraft.calculated?.altitude || aircraft.baro_rate === undefined) return { phase: 'unknown', confidence: 0 };
    if (aircraft.calculated.altitude < 0) return { phase: 'unknown', confidence: 0 };
    const recentAltitudes = trajectoryData.map((entry) => entry.snapshot.calculated?.altitude || entry.snapshot.alt_baro).filter((altitude) => altitude !== undefined && altitude >= 0);
    if (aircraft.baro_rate > 300) {
        if (aircraft.calculated.altitude < 5000 || (recentAltitudes.length > 0 && Math.min(...recentAltitudes) < 2000)) return { phase: 'initial-climb', confidence: 0.9 };
        return { phase: 'cruise-climb', confidence: 0.8 };
    }
    if (aircraft.baro_rate < -300) {
        if (aircraft.calculated.altitude < 8000 || (aircraft.gs && aircraft.gs < 250)) return { phase: 'approach', confidence: 0.8 };
        return { phase: 'descent', confidence: 0.8 };
    }
    if (Math.abs(aircraft.baro_rate) <= 300) {
        if (aircraft.calculated.altitude > 10000) return { phase: 'cruise', confidence: 0.9 };
        if (aircraft.gs && aircraft.gs < 100) return { phase: 'ground-or-pattern', confidence: 0.7 };
        return { phase: 'level', confidence: 0.7 };
    }
    return { phase: 'unknown', confidence: 0.5 };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function getExpectedPerformance(category, phase, altitude) {
    const profile = PERFORMANCE_PROFILES[category] || DEFAULT_PROFILE;
    let altitudeBand = 'low';
    if (altitude > 20000) altitudeBand = 'high';
    else if (altitude > 10000) altitudeBand = 'medium';
    switch (phase) {
        case 'initial-climb': {
            return {
                climbRate: profile.climb.initial,
                speed: profile.cruise[altitudeBand],
            };
        }
        case 'cruise-climb': {
            return {
                climbRate: profile.climb.cruise,
                speed: profile.cruise[altitudeBand],
            };
        }
        case 'level':
        case 'cruise': {
            return {
                climbRate: { min: -200, typical: 0, max: 200 },
                speed: profile.cruise[altitudeBand],
            };
        }
        case 'descent': {
            return {
                climbRate: profile.descent.normal,
                speed: profile.cruise[altitudeBand],
            };
        }
        case 'approach': {
            return {
                climbRate: profile.descent.approach,
                speed: {
                    min: profile.cruise.low.min * 0.7,
                    typical: profile.cruise.low.typical * 0.8,
                    max: profile.cruise.low.max * 0.9,
                },
            };
        }
        default: {
            return undefined;
        }
    }
}

function analyzeClimbPerformance(actual, expected, phase) {
    if (!expected || !expected.climbRate) return undefined;
    const { min, typical, max } = expected.climbRate;
    const typicalMagnitude = Math.abs(typical),
        actualMagnitude = Math.abs(actual),
        performanceRatio = typicalMagnitude > 0 ? actualMagnitude / typicalMagnitude : 0;
    if (phase.includes('climb') && actual < min * 0.7)
        // 30% buffer
        return {
            type: 'poor-climb',
            severity: actual < min * 0.5 ? 'high' : 'medium',
            details: `Climbing at ${actual} ft/min (expected minimum ${min})`,
            performanceRatio,
        };
    if (phase.includes('descent') && actual > max * 0.7)
        // 30% buffer
        return {
            type: 'shallow-descent',
            severity: actual > max * 0.5 ? 'high' : 'medium',
            details: `Descending at ${actual} ft/min (expected minimum ${min})`,
            performanceRatio,
        };
    // Check for excessive rates - be very tolerant
    if (phase.includes('climb') && actual > max * 1.8)
        // 80% buffer
        return {
            type: 'excessive-climb',
            severity: 'low',
            details: `Climbing at ${actual} ft/min (typical max ${max})`,
            performanceRatio,
        };
    return undefined;
}

function analyzeSpeedPerformance(actual, expected, altitude) {
    if (!expected || !expected.speed || !actual) return undefined;
    const { min, typical, max } = expected.speed,
        performanceRatio = actual / typical;
    const minWithBuffer = min * 0.9;
    if (actual < minWithBuffer)
        return {
            type: 'low-speed',
            severity: actual < min * 0.7 ? 'high' : 'medium',
            details: `${actual.toFixed(0)} kts at ${altitude} ft (minimum ${min})`,
            performanceRatio,
        };
    // Too fast - with 10% buffer
    if (actual > max * 1.1) {
        return {
            type: 'excessive-speed',
            severity: actual > max * 1.3 ? 'high' : 'medium',
            details: `${actual.toFixed(0)} kts at ${altitude} ft (maximum ${max})`,
            performanceRatio,
        };
    }

    return undefined;
}

function analyzeSustainedPerformance(trajectoryData, category) {
    if (trajectoryData.length < 8) return undefined; // Need more data for sustained analysis
    const profile = PERFORMANCE_PROFILES[category] || DEFAULT_PROFILE;
    const recentData = trajectoryData.slice(-10); // Last 10 data points
    const climbRates = recentData.map((entry) => entry.snapshot.baro_rate).filter((rate) => rate !== undefined && rate > 0);
    if (climbRates.length >= 8) {
        const avgClimbRate = climbRates.reduce((a, b) => a + b, 0) / climbRates.length;
        // Only flag if really poor (50% of expected)
        if (avgClimbRate < profile.climb.initial.min * 0.5)
            return {
                type: 'sustained-poor-climb',
                severity: 'high',
                details: `Average climb ${avgClimbRate.toFixed(0)} ft/min over ${climbRates.length} samples`,
                samples: climbRates.length,
            };
    }
    const altitudes = recentData.map((entry) => entry.snapshot.calculated?.altitude || entry.snapshot.alt_baro).filter((alt) => alt !== undefined && alt > 0);
    if (altitudes.length >= 8) {
        const altitudeTrend = altitudes[altitudes.length - 1] - altitudes[0];
        const speeds = recentData.map((entry) => entry.snapshot.gs).filter((speed) => speed !== undefined);
        if (speeds.length >= 5) {
            const speedTrend = speeds[speeds.length - 1] - speeds[0];
            // Losing significant altitude while slowing down significantly = performance issue
            if (altitudeTrend < -1000 && speedTrend < -50)
                return {
                    type: 'performance-degradation',
                    severity: 'high',
                    details: `Lost ${Math.abs(altitudeTrend).toFixed(0)} ft while speed decreased ${Math.abs(speedTrend).toFixed(0)} kts`,
                };
        }
    }
    return undefined;
}

function checkAltitudeCeiling(altitude, category, verticalRate) {
    const profile = PERFORMANCE_PROFILES[category] || DEFAULT_PROFILE;
    // Only alert if significantly above ceiling
    if (altitude > profile.ceiling + 1000) {
        const exceedance = altitude - profile.ceiling;
        return {
            type: 'ceiling-exceeded',
            severity: exceedance > 3000 ? 'high' : 'medium',
            details: `At ${altitude} ft, exceeds typical ceiling of ${profile.ceiling} ft by ${exceedance} ft`,
        };
    }
    // Near ceiling - only alert if struggling to climb
    if (altitude > profile.ceiling * 0.95 && verticalRate !== undefined && verticalRate < 100) {
        return {
            type: 'near-ceiling-struggling',
            severity: 'low',
            details: `At ${altitude} ft near ceiling with poor climb rate ${verticalRate} ft/min`,
        };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectPerformance(aircraft) {
    const issues = [];
    if (aircraft.calculated?.altitude === undefined || !aircraft.category) return undefined;
    if (aircraft.calculated.altitude < 0 || aircraft.calculated.altitude > 60000) return { hasIssues: false, reason: 'bad_altitude_data' };
    const trajectoryData = aircraft.calculated?.trajectoryData || [];
    const flightPhase = detectFlightPhase(aircraft, trajectoryData);
    if (flightPhase.phase === 'unknown' || flightPhase.phase === 'ground-or-pattern') return { hasIssues: false, phase: flightPhase.phase };
    const expected = getExpectedPerformance(aircraft.category, flightPhase.phase, aircraft.calculated.altitude);
    if (aircraft.baro_rate !== undefined && expected) {
        const climbIssue = analyzeClimbPerformance(aircraft.baro_rate, expected, flightPhase.phase);
        if (climbIssue) issues.push(climbIssue);
    }
    if (aircraft.gs && expected) {
        const speedIssue = analyzeSpeedPerformance(aircraft.gs, expected, aircraft.calculated.altitude);
        if (speedIssue) issues.push(speedIssue);
    }
    if (trajectoryData.length >= 8) {
        const sustainedIssue = analyzeSustainedPerformance(trajectoryData, aircraft.category);
        if (sustainedIssue) issues.push(sustainedIssue);
    }
    const ceilingIssue = checkAltitudeCeiling(aircraft.calculated.altitude, aircraft.category, aircraft.baro_rate);
    if (ceilingIssue) issues.push(ceilingIssue);
    return {
        hasIssues: issues.length > 0,
        issues,
        phase: flightPhase.phase,
        phaseConfidence: flightPhase.confidence,
        highestSeverity: issues.length > 0 ? issues.reduce((highest, issue) => (severityRank[issue.severity] > severityRank[highest] ? issue.severity : highest), 'low') : undefined,
        category: aircraft.category,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const severityRank = { high: 3, medium: 2, low: 1 };
const severityColors = { high: ' [HIGH]', medium: ' [MEDIUM]' };

module.exports = {
    id: 'performance',
    name: 'Aircraft performance monitoring',
    priority: 4, // Same as anomaly
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.performance = { hasIssues: false };
        const performance = detectPerformance(aircraft);
        if (performance) aircraft.calculated.performance = performance;
    },
    evaluate: (aircraft) => aircraft.calculated.performance.hasIssues,
    sort: (a, b) => {
        const a_ = a.calculated.performance,
            b_ = b.calculated.performance;
        return severityRank[a_.highestSeverity] - severityRank[b_.highestSeverity];
    },
    getStats: (aircrafts, list) => {
        const byType = list.flatMap((a) => a.calculated.performance.issues.map((i) => i.type)).reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const byCategory = list
            .map((a) => a.category)
            .filter(Boolean)
            .reduce((counts, cat) => ({ ...counts, [cat]: (counts[cat] || 0) + 1 }), {});
        const byPhase = list.map((a) => a.calculated.performance.phase).reduce((counts, phase) => ({ ...counts, [phase]: (counts[phase] || 0) + 1 }), {});
        return {
            total: list.length,
            byType,
            byCategory,
            byPhase,
        };
    },
    format: (aircraft) => {
        const { performance } = aircraft.calculated;
        const count = performance.issues.length;
        const [primary] = performance.issues;
        const text = count == 1 ? `${primary.type.replaceAll('-', ' ')}: ${primary.details}` : `${count} issues: ${[...new Set(performance.issues.map((i) => i.type.replaceAll('-', '')))].join(', ')}`;
        return {
            text: `performance (${performance.phase.replaceAll('-', ' ')}): ${text}${severityColors[performance.highestSeverity] || ''}`,
            warn: performance.highestSeverity === 'high',
            performanceInfo: {
                issues: performance.issues,
                phase: performance.phase,
                category: performance.category,
                severity: performance.highestSeverity,
            },
        };
    },
    debug: (type, _aircraft) => {
        if (type == 'sorting') return undefined;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
