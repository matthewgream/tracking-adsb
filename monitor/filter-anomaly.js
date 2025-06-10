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
    const expectedDiff = aircraft.mach * aircraft.mach * config.machTempCoefficient,
        actualDiff = aircraft.tat - aircraft.oat,
        deviation = Math.abs(actualDiff - expectedDiff);
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

function detectExtremeVerticalRate(config, aircraft) {
    if (!config.enabled) return undefined;
    if (!aircraft.baro_rate) return undefined;
    const absRate = Math.abs(aircraft.baro_rate);
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

function detectAltitudeOscillation(config, aircraftData) {
    if (!config.enabled) return undefined;

    const { values: altitudes } = aircraftData.getField('calculated.altitude', {
        minDataPoints: config.minimumDataPoints,
    });

    if (altitudes.length < config.minimumDataPoints) return undefined;

    const directionInfo = aircraftData.getDirectionChanges('calculated.altitude', config.minimumAltitudeChange);
    const altitudeRange = Math.max(...altitudes) - Math.min(...altitudes);

    const threshold = config.thresholds.find((t) => directionInfo.changes >= t.minDirectionChanges && altitudeRange >= t.minAltitudeRange);

    if (threshold) {
        return {
            type: 'altitude-oscillation',
            severity: threshold.severity,
            details: `${directionInfo.changes} direction changes, ${altitudeRange.toFixed(0)} ft range`,
            debug: {
                directionChanges: directionInfo.changes,
                altitudeRange,
                dataPoints: altitudes.length,
            },
        };
    }
    return undefined;
}

function detectAltitudeDeviation(config, aircraft, aircraftData) {
    if (!config.enabled) return undefined;
    if (!aircraft.nav_altitude_mcp || !aircraft.calculated?.altitude) return undefined;

    const { values: recentAltitudes } = aircraftData.getField('calculated.altitude', {
        minDataPoints: config.minimumDataPoints,
    });

    if (recentAltitudes.length < config.minimumDataPoints) return undefined;

    const assignedAltitude = aircraft.nav_altitude_mcp;
    const currentAltitude = aircraft.calculated.altitude;

    if (!recentAltitudes.some((alt) => Math.abs(alt - assignedAltitude) < config.stabilityThreshold)) return undefined;

    const deviation = Math.abs(currentAltitude - assignedAltitude);
    const deviationBand = config.deviationBands.find((band) => deviation >= band.minDeviation && deviation < band.maxDeviation);

    if (deviationBand) {
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
    }
    return undefined;
}

function detectRapidVerticalRateChange(config, aircraft, aircraftData) {
    if (!config.enabled) return undefined;
    if (!aircraft.baro_rate) return undefined;

    const { values: verticalRates } = aircraftData.getField('baro_rate', {
        minDataPoints: config.minimumDataPoints,
    });

    if (verticalRates.length < config.minimumDataPoints) return undefined;

    const currentRate = verticalRates[verticalRates.length - 1];
    const previousRate = verticalRates[verticalRates.length - 1 - config.lookbackIndex];
    const change = Math.abs(currentRate - previousRate);

    const threshold = config.thresholds.find((t) => change >= t.minChange && change < t.maxChange);

    if (threshold) {
        let { severity } = threshold;
        // Boost severity if TCAS is active
        if (config.tcasBoost && aircraft.nav_modes && aircraft.nav_modes.includes('tcas')) {
            severity = severity === 'medium' ? 'high' : severity;
        }

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

function detectRapidSpeedChange(config, aircraftData) {
    if (!config.enabled) return undefined;

    const { values: speeds } = aircraftData.getField('gs', {
        minDataPoints: config.minimumDataPoints,
    });

    if (speeds.length < config.minimumDataPoints) return undefined;

    const currentSpeed = speeds[speeds.length - 1];
    const [initialSpeed] = speeds;
    const change = Math.abs(currentSpeed - initialSpeed);
    const updates = speeds.length;

    // Find matching threshold considering both change magnitude and time
    const threshold = config.thresholds.find((t) => change >= t.minChange && change < t.maxChange && updates <= t.maxUpdates);

    if (threshold) {
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
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAnomaly(aircraft, aircraftData) {
    if (aircraft.hex === undefined) return undefined;
    const anomalies = [
        detectHighSpeedLowAltitude(HIGH_SPEED_LOW_ALTITUDE_CONFIG, aircraft),
        detectLowSpeedHighAltitude(LOW_SPEED_HIGH_ALTITUDE_CONFIG, aircraft),
        detectTemperatureAnomaly(TEMPERATURE_ANOMALY_CONFIG, aircraft),
        detectAltitudeOscillation(ALTITUDE_OSCILLATION_CONFIG, aircraftData),
        detectAltitudeDeviation(ALTITUDE_DEVIATION_CONFIG, aircraft, aircraftData),
        detectExtremeVerticalRate(EXTREME_VERTICAL_RATE_CONFIG, aircraft),
        detectRapidVerticalRateChange(RAPID_VERTICAL_RATE_CHANGE_CONFIG, aircraft, aircraftData),
        detectRapidSpeedChange(RAPID_SPEED_CHANGE_CONFIG, aircraftData),
    ].filter(Boolean);
    if (anomalies.length === 0) return undefined;
    return {
        hasAnomaly: true,
        anomalies,
        highestSeverity: anomalies.reduce((highest, current) => (severityRank[current.severity] > severityRank[highest] ? current.severity : highest), 'low'),
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
    preprocess: (aircraft, { aircraftData }) => {
        aircraft.calculated.anomaly = { hasAnomaly: false };
        const anomaly = detectAnomaly(aircraft, aircraftData);
        if (anomaly) aircraft.calculated.anomaly = anomaly;
    },
    evaluate: (aircraft) => aircraft.calculated.anomaly.hasAnomaly,
    sort: (a, b) => {
        const a_ = a.calculated.anomaly,
            b_ = b.calculated.anomaly;
        return severityRank[b_.highestSeverity] - severityRank[a_.highestSeverity];
    },
    getStats: (aircrafts, list) => {
        const byType = list.flatMap((a) => a.calculated.anomaly.anomalies.map((t) => t.type)).reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const bySeverity = list.map((a) => a.calculated.anomaly.highestSeverity).reduce((counts, severity) => ({ ...counts, [severity]: (counts[severity] || 0) + 1 }), {});
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
    debug: (type, aircraft) => {
        const { anomaly } = aircraft.calculated;
        if (type == 'sorting') return `severity=${anomaly.highestSeverity}, count=${anomaly.anomalies.length}`;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
