// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const configDefault = {
    icingConditions: {
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
    },
    severeIcing: {
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
    },
    turbulence: {
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
    },
    strongWinds: {
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
    },
    temperatureInversion: {
        enabled: true,
        standardLapseRate: 2, // °C per 1000ft
        deviationThreshold: 10, // °C deviation from ISA to trigger
        severity: 'low',
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectIcingConditions(config, aircraft) {
    if (!config.enabled) return undefined;
    if (aircraft.oat === undefined || !aircraft.calculated?.altitude) return undefined;
    const inIcingTemp = aircraft.oat >= config.temperatureRange.min && aircraft.oat <= config.temperatureRange.max;
    if (!inIcingTemp) return undefined;
    const altitudeBand = config.altitudeBands.find((band) => aircraft.calculated.altitude >= band.minAltitude && aircraft.calculated.altitude <= band.maxAltitude);
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
    if (aircraft.oat >= sldConditions.temperatureRange.min && aircraft.oat <= sldConditions.temperatureRange.max && aircraft.calculated.altitude <= sldConditions.maxAltitude)
        return {
            type: 'severe-icing',
            severity: sldConditions.severity,
            details: `SLD risk: ${aircraft.oat}°C at ${aircraft.calculated.altitude.toFixed(0)} ft`,
        };
    return undefined;
}

function detectTurbulence(config, aircraftData) {
    if (!config.enabled) return undefined;

    const { values: verticalRates } = aircraftData.getField('baro_rate', {
        minDataPoints: config.minimumDataPoints,
    });

    if (verticalRates.length < config.minimumDataPoints) return undefined;

    const maxRate = Math.max(...verticalRates),
        minRate = Math.min(...verticalRates),
        variation = maxRate - minRate;
    if (variation > config.variationThreshold) {
        const stats = aircraftData.getStats('baro_rate');
        const severityBand = config.severityBands.find((band) => stats.stdDev <= band.maxStdDev);
        if (severityBand)
            return {
                type: 'turbulence',
                severity: severityBand.severity,
                details: `${severityBand.description}: vertical rate σ=${stats.stdDev.toFixed(0)} ft/min`,
                debug: {
                    standardDeviation: stats.stdDev,
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

function detectWeather(config, aircraft, aircraftData) {
    if (!aircraft.hex) return undefined;
    const conditions = [
        detectIcingConditions(config.icingConditions, aircraft),
        detectSevereIcingRisk(config.severeIcing, aircraft),
        detectTurbulence(config.turbulence, aircraftData),
        detectStrongWinds(config.strongWinds, aircraft),
        detectTemperatureInversion(config.temperatureInversion, aircraft),
    ].filter(Boolean);
    if (conditions.length === 0) return undefined;
    return {
        inWeatherOperation: true,
        conditions,
        highestSeverity: conditions.reduce((highest, current) => (severityRank[current.severity] > severityRank[highest] ? current.severity : highest), 'low'),
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
        this.conf = Object.fromEntries(Object.entries(configDefault).map(([module, config]) => [module, { ...config, ...conf[module] }]));
        this.extra = extra;
    },
    preprocess: (aircraft, { aircraftData }) => {
        aircraft.calculated.weather = { inWeatherOperation: false };
        const weather = detectWeather(this.conf, aircraft, aircraftData);
        if (weather) aircraft.calculated.weather = weather;
    },
    evaluate: (aircraft) => aircraft.calculated.weather.inWeatherOperation,
    sort: (a, b) => {
        const a_ = a.calculated.weather,
            b_ = b.calculated.weather;
        return severityRank[b_.highestSeverity] - severityRank[a_.highestSeverity];
    },
    getStats: (aircrafts, list) => {
        const byCondition = list.flatMap((a) => a.calculated.weather.conditions.map((c) => c.type)).reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const bySeverity = list.map((a) => a.calculated.weather.highestSeverity).reduce((counts, severity) => ({ ...counts, [severity]: (counts[severity] || 0) + 1 }), {});
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
    debug: (type, aircraft) => {
        const { weather } = aircraft.calculated;
        if (type == 'sorting') return `severity=${weather.highestSeverity}, count=${weather.conditions.length}`;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
