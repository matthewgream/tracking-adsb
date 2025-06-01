// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const HIGH_SPEED_LOW_ALTITUDE_CONFIG = {
    enabled: true,
    thresholds: [
        {
            maxAltitude: 10000,
            maxSpeed: 350,
            severity: 'high',
            description: 'very low altitude',
        },
        {
            maxAltitude: 15000,
            maxSpeed: 400,
            severity: 'medium',
            description: 'low altitude',
        },
        {
            maxAltitude: 20000,
            maxSpeed: 450,
            severity: 'low',
            description: 'medium altitude',
        },
    ],
};

const LOW_SPEED_HIGH_ALTITUDE_CONFIG = {
    enabled: true,
    thresholds: [
        {
            minAltitude: 30000,
            minSpeed: 250,
            severity: 'medium',
            description: 'high altitude',
        },
        {
            minAltitude: 35000,
            minSpeed: 280,
            severity: 'high',
            description: 'very high altitude',
        },
    ],
};

const TEMPERATURE_ANOMALY_CONFIG = {
    enabled: true,
    machTempCoefficient: 40, // Temperature rise coefficient for Mach number
    deviationThreshold: 20, // °C deviation between expected and actual
    severity: 'low',
};

const ALTITUDE_OSCILLATION_CONFIG = {
    enabled: true,
    minimumDataPoints: 5,
    minimumAltitudeChange: 300, // ft between readings to count as a change
    thresholds: [
        {
            minDirectionChanges: 2,
            minAltitudeRange: 2000, // ft total variation
            severity: 'medium',
            description: 'altitude oscillation',
        },
        {
            minDirectionChanges: 4,
            minAltitudeRange: 3000, // ft total variation
            severity: 'high',
            description: 'severe altitude oscillation',
        },
    ],
};

const ALTITUDE_DEVIATION_CONFIG = {
    enabled: true,
    minimumDataPoints: 5,
    stabilityThreshold: 300, // ft - consider aircraft "at" assigned altitude
    deviationBands: [
        {
            minDeviation: 800,
            maxDeviation: 1500,
            severity: 'low',
            description: 'minor deviation',
        },
        {
            minDeviation: 1500,
            maxDeviation: 3000,
            severity: 'medium',
            description: 'significant deviation',
        },
        {
            minDeviation: 3000,
            maxDeviation: Infinity,
            severity: 'high',
            description: 'major deviation',
        },
    ],
};

const EXTREME_VERTICAL_RATE_CONFIG = {
    enabled: true,
    thresholds: [
        {
            minRate: 6000,
            maxRate: 8000,
            severity: 'medium',
            description: 'extreme vertical rate',
        },
        {
            minRate: 8000,
            maxRate: 10000,
            severity: 'high',
            description: 'very extreme vertical rate',
        },
        {
            minRate: 10000,
            maxRate: Infinity,
            severity: 'high',
            description: 'exceptional vertical rate',
        },
    ],
};

const RAPID_VERTICAL_RATE_CHANGE_CONFIG = {
    enabled: true,
    minimumDataPoints: 3,
    lookbackIndex: 2, // Compare current to this many readings back
    thresholds: [
        {
            minChange: 2000,
            maxChange: 3000,
            severity: 'medium',
            description: 'rapid vertical rate change',
        },
        {
            minChange: 3000,
            maxChange: 5000,
            severity: 'high',
            description: 'very rapid vertical rate change',
        },
        {
            minChange: 5000,
            maxChange: Infinity,
            severity: 'high',
            description: 'extreme vertical rate change',
        },
    ],
    tcasBoost: true, // Increase severity if TCAS is active
};

const RAPID_SPEED_CHANGE_CONFIG = {
    enabled: true,
    minimumDataPoints: 3,
    thresholds: [
        {
            minChange: 100,
            maxChange: 150,
            maxUpdates: 20,
            severity: 'low',
            description: 'rapid speed change',
        },
        {
            minChange: 150,
            maxChange: 200,
            maxUpdates: 10,
            severity: 'medium',
            description: 'very rapid speed change',
        },
        {
            minChange: 200,
            maxChange: Infinity,
            maxUpdates: 5,
            severity: 'high',
            description: 'extreme speed change',
        },
    ],
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectHighSpeedLowAltitude(config, aircraft) {
    if (!config.enabled) return undefined;
    if (!aircraft.gs || !aircraft.calculated?.altitude) return undefined;
    // Find matching threshold
    const threshold = config.thresholds.find((t) => aircraft.calculated.altitude <= t.maxAltitude && aircraft.gs > t.maxSpeed);
    if (threshold)
        return {
            type: 'high-speed-low-altitude',
            severity: threshold.severity,
            details: `${aircraft.gs.toFixed(0)} kts at ${aircraft.calculated.altitude.toFixed(0)} ft (${threshold.description})`,
            debug: {
                speed: aircraft.gs,
                altitude: aircraft.calculated.altitude,
                threshold: threshold.maxSpeed,
            },
        };
    return undefined;
}

function detectLowSpeedHighAltitude(config, aircraft) {
    if (!config.enabled) return undefined;
    if (!aircraft.gs || !aircraft.calculated?.altitude) return undefined;
    // Find matching threshold
    const threshold = config.thresholds.find((t) => aircraft.calculated.altitude >= t.minAltitude && aircraft.gs < t.minSpeed);
    if (threshold)
        return {
            type: 'low-speed-high-altitude',
            severity: threshold.severity,
            details: `${aircraft.gs.toFixed(0)} kts at ${aircraft.calculated.altitude.toFixed(0)} ft (${threshold.description})`,
            debug: {
                speed: aircraft.gs,
                altitude: aircraft.calculated.altitude,
                threshold: threshold.minSpeed,
            },
        };
    return undefined;
}

function detectTemperatureAnomaly(config, aircraft) {
    if (!config.enabled) return undefined;
    if (aircraft.oat === undefined || aircraft.tat === undefined || !aircraft.mach) return undefined;
    const expectedDiff = aircraft.mach * aircraft.mach * config.machTempCoefficient;
    const actualDiff = aircraft.tat - aircraft.oat;
    const deviation = Math.abs(actualDiff - expectedDiff);
    if (deviation > config.deviationThreshold)
        return {
            type: 'temperature-anomaly',
            severity: config.severity,
            details: `OAT ${aircraft.oat}°C, TAT ${aircraft.tat}°C, Mach ${aircraft.mach.toFixed(2)} (${deviation.toFixed(0)}°C deviation)`,
            debug: {
                expectedDiff,
                actualDiff,
                deviation,
            },
        };
    return undefined;
}

function detectAltitudeOscillation(config, altitudes) {
    if (!config.enabled) return undefined;
    if (!altitudes || altitudes.length < config.minimumDataPoints) return undefined;
    // Calculate direction changes
    const altChangeDirections = [];
    for (let i = 1; i < altitudes.length; i++) {
        const change = altitudes[i] - altitudes[i - 1];
        if (Math.abs(change) > config.minimumAltitudeChange) altChangeDirections.push(change > 0 ? 'up' : 'down');
    }
    // Count direction changes
    let directionChanges = 0;
    for (let i = 1; i < altChangeDirections.length; i++) if (altChangeDirections[i] !== altChangeDirections[i - 1]) directionChanges++;
    // Calculate altitude range
    const maxAlt = Math.max(...altitudes),
        minAlt = Math.min(...altitudes),
        altitudeRange = maxAlt - minAlt;
    // Find matching threshold
    const threshold = config.thresholds.find((t) => directionChanges >= t.minDirectionChanges && altitudeRange >= t.minAltitudeRange);
    if (threshold)
        return {
            type: 'altitude-oscillation',
            severity: threshold.severity,
            details: `${directionChanges} direction changes, ${altitudeRange.toFixed(0)} ft range`,
            debug: {
                directionChanges,
                altitudeRange,
                dataPoints: altitudes.length,
            },
        };
    return undefined;
}

function detectAltitudeDeviation(config, aircraft, recentAltitudes) {
    if (!config.enabled) return undefined;
    if (!aircraft.nav_altitude_mcp || !aircraft.calculated?.altitude || !recentAltitudes || recentAltitudes.length < config.minimumDataPoints) return undefined;
    const assignedAltitude = aircraft.nav_altitude_mcp;
    const currentAltitude = aircraft.calculated.altitude;
    // Check if aircraft was previously at assigned altitude
    const wasAtAssigned = recentAltitudes.some((alt) => Math.abs(alt - assignedAltitude) < config.stabilityThreshold);
    if (!wasAtAssigned) return undefined;
    const deviation = Math.abs(currentAltitude - assignedAltitude);
    // Find matching deviation band
    const deviationBand = config.deviationBands.find((band) => deviation >= band.minDeviation && deviation < band.maxDeviation);
    if (deviationBand)
        return {
            type: 'altitude-deviation',
            severity: deviationBand.severity,
            details: `${deviation.toFixed(0)} ft ${deviationBand.description} from assigned ${assignedAltitude} ft`,
            debug: {
                currentAltitude,
                assignedAltitude,
                deviation,
            },
        };
    return undefined;
}

function detectExtremeVerticalRate(config, aircraft) {
    if (!config.enabled) return undefined;
    if (!aircraft.baro_rate) return undefined;
    const absRate = Math.abs(aircraft.baro_rate);
    // Find matching threshold
    const threshold = config.thresholds.find((t) => absRate >= t.minRate && absRate < t.maxRate);
    if (threshold)
        return {
            type: 'extreme-vertical-rate',
            severity: threshold.severity,
            details: `${aircraft.baro_rate > 0 ? '+' : '-'}${absRate.toFixed(0)} ft/min (${threshold.description})`,
            debug: {
                verticalRate: aircraft.baro_rate,
                threshold: threshold.minRate,
            },
        };
    return undefined;
}

function detectRapidVerticalRateChange(config, aircraft, verticalRates) {
    if (!config.enabled) return undefined;
    if (!aircraft.baro_rate || !verticalRates || verticalRates.length < config.minimumDataPoints) return undefined;
    const currentRate = verticalRates[verticalRates.length - 1];
    const previousRate = verticalRates[verticalRates.length - 1 - config.lookbackIndex];
    const change = Math.abs(currentRate - previousRate);
    // Find matching threshold
    const threshold = config.thresholds.find((t) => change >= t.minChange && change < t.maxChange);
    if (threshold) {
        let { severity } = threshold;
        // Boost severity if TCAS is active
        if (config.tcasBoost && aircraft.nav_modes && aircraft.nav_modes.includes('tcas')) severity = severity === 'medium' ? 'high' : severity;
        return {
            type: 'vertical-rate-change',
            severity,
            details: `${change.toFixed(0)} ft/min change${aircraft.nav_modes && aircraft.nav_modes.includes('tcas') ? ' (TCAS active)' : ''}`,
            debug: {
                currentRate,
                previousRate,
                change,
                tcasActive: aircraft.nav_modes && aircraft.nav_modes.includes('tcas'),
            },
        };
    }
    return undefined;
}

function detectRapidSpeedChange(config, speeds) {
    if (!config.enabled) return undefined;
    if (!speeds || speeds.length < config.minimumDataPoints) return undefined;
    const currentSpeed = speeds[speeds.length - 1];
    const [initialSpeed] = speeds;
    const change = Math.abs(currentSpeed - initialSpeed);
    const updates = speeds.length;
    // Find matching threshold considering both change magnitude and time
    const threshold = config.thresholds.find((t) => change >= t.minChange && change < t.maxChange && updates <= t.maxUpdates);
    if (threshold)
        return {
            type: 'rapid-speed-change',
            severity: threshold.severity,
            details: `${change.toFixed(0)} knots in ${updates} updates (${threshold.description})`,
            debug: {
                initialSpeed,
                currentSpeed,
                change,
                updates,
            },
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateVariables(aircraft) {
    const trajectoryData = aircraft.calculated?.trajectoryData || [];
    const altitudes = [],
        verticalRates = [],
        speeds = [],
        positions = [],
        timestamps = [];
    trajectoryData.forEach((entry) => {
        const { snapshot, timestamp } = entry;
        timestamps.push(timestamp);
        if (snapshot.calculated?.altitude !== undefined) altitudes.push(snapshot.calculated.altitude);
        if (snapshot.baro_rate !== undefined) verticalRates.push(snapshot.baro_rate);
        if (snapshot.gs !== undefined) speeds.push(snapshot.gs);
        if (snapshot.lat !== undefined && snapshot.lon !== undefined) positions.push({ lat: snapshot.lat, lon: snapshot.lon, timestamp });
    });
    const lastSnapshot = trajectoryData[trajectoryData.length - 1]?.snapshot;
    const now = Date.now();
    if (aircraft.calculated?.altitude !== undefined && (!lastSnapshot || lastSnapshot.calculated?.altitude !== aircraft.calculated.altitude))
        altitudes.push(aircraft.calculated.altitude);
    if (aircraft.baro_rate !== undefined && (!lastSnapshot || lastSnapshot.baro_rate !== aircraft.baro_rate)) verticalRates.push(aircraft.baro_rate);
    if (aircraft.gs !== undefined && (!lastSnapshot || lastSnapshot.gs !== aircraft.gs)) speeds.push(aircraft.gs);
    if (aircraft.lat !== undefined && aircraft.lon !== undefined && (!lastSnapshot || lastSnapshot.lat !== aircraft.lat || lastSnapshot.lon !== aircraft.lon))
        positions.push({ lat: aircraft.lat, lon: aircraft.lon, timestamp: now });
    return {
        altitudes,
        verticalRates,
        speeds,
        positions,
        timestamps,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const severityRank = { high: 3, medium: 2, low: 1 };
const severityColors = { high: ' [HIGH]', medium: ' [MEDIUM]' };

module.exports = {
    id: 'anomaly',
    name: 'Aircraft Operational Anomalies',
    priority: 4,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.anomaly = { hasAnomaly: false, anomalies: [] };
        if (!aircraft.hex) return;
        const variables = calculateVariables(aircraft);
        const anomalies = [
            detectHighSpeedLowAltitude(HIGH_SPEED_LOW_ALTITUDE_CONFIG, aircraft),
            detectLowSpeedHighAltitude(LOW_SPEED_HIGH_ALTITUDE_CONFIG, aircraft),
            detectTemperatureAnomaly(TEMPERATURE_ANOMALY_CONFIG, aircraft),
            detectAltitudeOscillation(ALTITUDE_OSCILLATION_CONFIG, variables.altitudes),
            detectAltitudeDeviation(ALTITUDE_DEVIATION_CONFIG, aircraft, variables.altitudes),
            detectExtremeVerticalRate(EXTREME_VERTICAL_RATE_CONFIG, aircraft),
            detectRapidVerticalRateChange(RAPID_VERTICAL_RATE_CHANGE_CONFIG, aircraft, variables.verticalRates),
            detectRapidSpeedChange(RAPID_SPEED_CHANGE_CONFIG, variables.speeds),
        ].filter(Boolean);
        if (anomalies.length > 0)
            aircraft.calculated.anomaly = {
                hasAnomaly: true,
                anomalies,
                highestSeverity: anomalies.reduce(
                    (highest, current) => (severityRank[current.severity] > severityRank[highest] ? current.severity : highest),
                    'low'
                ),
            };
    },
    evaluate: (aircraft) => aircraft.calculated.anomaly.hasAnomaly,
    sort: (a, b) => {
        const a_ = a.calculated.anomaly,
            b_ = b.calculated.anomaly;
        return (severityRank[b_.highestSeverity] ?? 0) - (severityRank[a_.highestSeverity] ?? 0);
    },
    getStats: (aircrafts, list) => {
        const byType = list
            .flatMap((a) => a.calculated.anomaly.anomalies.map((t) => t.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const bySeverity = list
            .map((a) => a.calculated.anomaly.highestSeverity)
            .reduce((counts, severity) => ({ ...counts, [severity]: (counts[severity] || 0) + 1 }), {});
        return {
            highSeverityCount: bySeverity.high || 0,
            mediumSeverityCount: bySeverity.medium || 0,
            lowSeverityCount: bySeverity.low || 0,
            byType,
            bySeverity,
        };
    },
    format: (aircraft) => {
        const { anomaly } = aircraft.calculated;
        const count = anomaly.anomalies.length;
        const counts = anomaly.anomalies.reduce((counts, anomaly) => ({ ...counts, [anomaly.type]: (counts[anomaly.type] || 0) + 1 }), {});
        const list =
            Object.entries(counts)
                .map(([type, count]) => `${type}${count > 1 ? ':' + count : ''}`)
                .join(', ') + (count == 1 ? ` (${anomaly.anomalies[0].details})` : ` (...)`);
        return {
            text: `anomalies: [${count}] ${list}${severityColors[anomaly.highestSeverity] || ''}`,
            warn: anomaly.highestSeverity === 'high',
            anomalyInfo: {
                types: anomaly.anomalies,
                severity: anomaly.highestSeverity,
                counts,
                count,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
