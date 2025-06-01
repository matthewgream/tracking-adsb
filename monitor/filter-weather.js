// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const ICING_CONDITIONS_CONFIG = {
    enabled: false,
    temperatureRange: {
        min: -15,
        max: 3,
    },
    altitudeBands: [
        {
            minAltitude: 8000,
            maxAltitude: 30000,
            severity: 'medium',
            description: 'potential icing zone',
        },
    ],
};

const SEVERE_ICING_CONFIG = {
    enabled: false,
    sldConditions: {
        // Supercooled Large Droplet conditions
        temperatureRange: {
            min: -10, // °C
            max: 0, // °C
        },
        maxAltitude: 15000,
        severity: 'high',
    },
};

const TURBULENCE_CONFIG = {
    enabled: true,
    minimumDataPoints: 5,
    variationThreshold: 1200, // ft/min variation to trigger analysis
    severityBands: [
        {
            maxStdDev: 600,
            severity: 'low',
            description: 'light turbulence',
        },
        {
            maxStdDev: 1000,
            severity: 'medium',
            description: 'moderate turbulence',
        },
        {
            maxStdDev: Infinity,
            severity: 'high',
            description: 'severe turbulence',
        },
    ],
};

const STRONG_WINDS_CONFIG = {
    enabled: true,
    altitudeBands: [
        {
            maxAltitude: 10000,
            threshold: 50, // kts GS/TAS difference
            severity: 'medium',
            description: 'low altitude',
        },
        {
            maxAltitude: 20000,
            threshold: 75, // kts GS/TAS difference
            severity: 'low',
            description: 'medium altitude',
        },
        {
            maxAltitude: 30000,
            threshold: 120, // kts GS/TAS difference
            severity: 'low',
            description: 'high altitude',
        },
        {
            maxAltitude: Infinity,
            threshold: 150, // kts GS/TAS difference
            severity: 'low',
            description: 'cruise altitude',
        },
    ],
    minimumDifference: 40, // Minimum GS/TAS difference to consider
};

const TEMPERATURE_INVERSION_CONFIG = {
    enabled: true,
    standardLapseRate: 2, // °C per 1000ft
    deviationThreshold: 10, // °C deviation from ISA to trigger
    severity: 'low',
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectIcingConditions(config, aircraft) {
    if (!config.enabled) return undefined;
    if (aircraft.oat === undefined || !aircraft.calculated?.altitude) return undefined;
    const inIcingTemp = aircraft.oat >= config.temperatureRange.min && aircraft.oat <= config.temperatureRange.max;
    if (!inIcingTemp) return undefined;
    const altitudeBand = config.altitudeBands.find(
        (band) => aircraft.calculated.altitude >= band.minAltitude && aircraft.calculated.altitude <= band.maxAltitude
    );
    if (altitudeBand)
        return {
            type: 'potential-icing',
            severity: altitudeBand.severity,
            details: `OAT ${aircraft.oat}°C at ${aircraft.calculated.altitude.toFixed(0)} ft in ${altitudeBand.description}`,
        };
    return undefined;
}

function detectSevereIcingRisk(config, aircraft) {
    if (!config.enabled) return undefined;
    if (aircraft.oat === undefined || !aircraft.calculated?.altitude) return undefined;
    const { sldConditions } = config;
    if (
        aircraft.oat >= sldConditions.temperatureRange.min &&
        aircraft.oat <= sldConditions.temperatureRange.max &&
        aircraft.calculated.altitude <= sldConditions.maxAltitude
    )
        return {
            type: 'severe-icing',
            severity: sldConditions.severity,
            details: `SLD risk: ${aircraft.oat}°C at ${aircraft.calculated.altitude.toFixed(0)} ft`,
        };
    return undefined;
}

function detectTurbulence(config, verticalRates) {
    if (!config.enabled) return undefined;
    if (!verticalRates || verticalRates.length < config.minimumDataPoints) return undefined;
    const maxRate = Math.max(...verticalRates),
        minRate = Math.min(...verticalRates),
        variation = maxRate - minRate;
    if (variation > config.variationThreshold) {
        const average = verticalRates.reduce((sum, rate) => sum + rate, 0) / verticalRates.length,
            variance = verticalRates.reduce((sum, rate) => sum + (rate - average) ** 2, 0) / verticalRates.length,
            standardDeviation = Math.sqrt(variance),
            severityBand = config.severityBands.find((band) => standardDeviation <= band.maxStdDev);
        if (severityBand)
            return {
                type: 'turbulence',
                severity: severityBand.severity,
                details: `${severityBand.description}: vertical rate σ=${standardDeviation.toFixed(0)} ft/min`,
                debug: {
                    standardDeviation,
                    variation,
                    dataPoints: verticalRates.length,
                },
            };
    }
    return undefined;
}

function detectStrongWinds(config, aircraft) {
    if (!config.enabled) return undefined;
    if (!aircraft.gs || !aircraft.tas || !aircraft.calculated?.altitude) return undefined;
    const difference = Math.abs(aircraft.gs - aircraft.tas);
    if (difference < config.minimumDifference) return undefined;
    const altitudeBand = config.altitudeBands.find((band) => aircraft.calculated.altitude <= band.maxAltitude);
    if (!altitudeBand) return undefined;
    if (difference > altitudeBand.threshold)
        return {
            type: 'strong-winds',
            severity: altitudeBand.severity,
            details: `${difference.toFixed(0)} kts GS/TAS difference at ${altitudeBand.description}`,
            debug: {
                altitude: aircraft.calculated.altitude,
                groundSpeed: aircraft.gs,
                trueAirspeed: aircraft.tas,
                threshold: altitudeBand.threshold,
            },
        };
    return undefined;
}

function detectTemperatureInversion(config, aircraft) {
    if (!config.enabled) return undefined;
    if (aircraft.oat === undefined || !aircraft.calculated?.altitude) return undefined;
    const seaLevelTemp = 15, // °C (ISA standard)
        expectedTemp = seaLevelTemp - (aircraft.calculated.altitude / 1000) * config.standardLapseRate,
        tempDeviation = aircraft.oat - expectedTemp;
    // Check if deviation exceeds threshold
    if (Math.abs(tempDeviation) > config.deviationThreshold)
        return {
            type: 'temperature-anomaly',
            severity: config.severity,
            details: `${tempDeviation > 0 ? '+' : ''}${tempDeviation.toFixed(0)}°C from ISA`,
            debug: {
                actualTemp: aircraft.oat,
                expectedTemp,
                altitude: aircraft.calculated.altitude,
            },
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateVariables(aircraft) {
    const trajectoryData = aircraft.calculated?.trajectoryData || [];
    const verticalRates = [],
        timestamps = [];
    trajectoryData.forEach((entry) => {
        const { snapshot, timestamp } = entry;
        if (snapshot.baro_rate !== undefined) {
            verticalRates.push(snapshot.baro_rate);
            timestamps.push(timestamp);
        }
    });
    const lastSnapshot = trajectoryData[trajectoryData.length - 1]?.snapshot;
    const now = Date.now();
    if (aircraft.baro_rate !== undefined && (!lastSnapshot || lastSnapshot.baro_rate !== aircraft.baro_rate)) {
        verticalRates.push(aircraft.baro_rate);
        timestamps.push(now);
    }
    return {
        verticalRates,
        timestamps,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const severityRank = { high: 3, medium: 2, low: 1 };
const severityColors = { high: ' [HIGH]', medium: ' [MEDIUM]' };

module.exports = {
    id: 'weather',
    name: 'Aircraft Weather Operations',
    priority: 5,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.weather = { inWeatherOperation: false };
        if (!aircraft.hex) return;
        const variables = calculateVariables(aircraft);
        const conditions = [
            detectIcingConditions(ICING_CONDITIONS_CONFIG, aircraft),
            detectSevereIcingRisk(SEVERE_ICING_CONFIG, aircraft),
            detectTurbulence(TURBULENCE_CONFIG, variables.verticalRates),
            detectStrongWinds(STRONG_WINDS_CONFIG, aircraft),
            detectTemperatureInversion(TEMPERATURE_INVERSION_CONFIG, aircraft),
        ].filter(Boolean);
        if (conditions.length > 0)
            aircraft.calculated.weather = {
                inWeatherOperation: true,
                conditions,
                highestSeverity: conditions.reduce(
                    (highest, current) => (severityRank[current.severity] > severityRank[highest] ? current.severity : highest),
                    'low'
                ),
            };
    },
    evaluate: (aircraft) => aircraft.calculated.weather.inWeatherOperation,
    sort: (a, b) => {
        const a_ = a.calculated.weather,
            b_ = b.calculated.weather;
        if (!a_.inWeatherOperation) return 1;
        if (!b_.inWeatherOperation) return -1;
        //
        return severityRank[a_.highestSeverity] - severityRank[b_.highestSeverity];
    },
    getStats: (aircrafts, list) => {
        const byCondition = list
            .flatMap((a) => a.calculated.weather.conditions.map((c) => c.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const bySeverity = list
            .map((a) => a.calculated.weather.highestSeverity)
            .reduce((counts, severity) => ({ ...counts, [severity]: (counts[severity] || 0) + 1 }), {});
        return {
            highSeverityCount: bySeverity.high || 0,
            mediumSeverityCount: bySeverity.medium || 0,
            lowSeverityCount: bySeverity.low || 0,
            byCondition,
            bySeverity,
        };
    },
    format: (aircraft) => {
        const { weather } = aircraft.calculated;
        const count = weather.conditions.length;
        const counts = weather.conditions.reduce((counts, condition) => ({ ...counts, [condition.type]: (counts[condition.type] || 0) + 1 }), {});
        const list =
            Object.entries(counts)
                .map(([type, count]) => `${type}${count > 1 ? ':' + count : ''}`)
                .join(', ') + (count == 1 ? ` (${weather.conditions[0].details})` : ` (...)`);
        return {
            text: `weather: [${count}] ${list}${severityColors[weather.highestSeverity] || ''}`,
            warn: weather.highestSeverity === 'high',
            weatherInfo: {
                conditions: weather.conditions,
                severity: weather.highestSeverity,
                counts,
                count,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
