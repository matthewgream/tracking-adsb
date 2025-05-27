// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/*function detectIcingConditions(aircraft) {
    if (aircraft.oat === undefined || !aircraft.calculated?.altitude) return undefined;
    // Potential icing conditions: temps between -15°C and +3°C with visible moisture
    // We don't have moisture data, so we'll use altitude bands where moisture is likely
    const inPotentialIcingTemp = aircraft.oat > -15 && aircraft.oat < 3,
        inPotentialIcingAlt = aircraft.calculated.altitude > 8000 && aircraft.calculated.altitude < 30000;
    if (inPotentialIcingTemp && inPotentialIcingAlt)
        return {
            type: 'potential-icing',
            severity: 'medium',
            details: `OAT ${aircraft.oat}°C at ${aircraft.calculated.altitude.toFixed(0)} ft`,
        };
    return undefined;
}*/

/*function detectSeverIcingRisk(aircraft) {
    if (aircraft.oat === undefined || !aircraft.calculated?.altitude) return undefined;
    // Supercooled large droplet (SLD) icing risk
    if (aircraft.oat > -10 && aircraft.oat < 0 && aircraft.calculated.altitude < 15000)
        return {
            type: 'severe-icing',
            severity: 'high',
            details: `SLD risk ${aircraft.oat}°C at ${aircraft.calculated.altitude.toFixed(0)} ft`,
        };
    return undefined;
}*/

function detectTurbulence(verticalRates) {
    if (!verticalRates || verticalRates.length < 5) return undefined;
    const maxRate = Math.max(...verticalRates),
        minRate = Math.min(...verticalRates),
        variation = maxRate - minRate;

    if (variation > 1200) {
        const avg = verticalRates.reduce((sum, rate) => sum + rate, 0) / verticalRates.length;
        const variance = verticalRates.reduce((sum, rate) => sum + (rate - avg) ** 2, 0) / verticalRates.length;
        const stdDev = Math.sqrt(variance);
        const getSeverity = (stdDev) => {
            if (stdDev > 1000) return 'high';
            if (stdDev > 600) return 'medium';
            return 'low';
        };
        return {
            type: 'turbulence',
            severity: getSeverity(stdDev),
            details: `vertical rate ${stdDev.toFixed(0)} ft/min`,
        };
    }
    return undefined;
}

function detectStrongWinds(aircraft) {
    if (!aircraft.gs || !aircraft.tas || !aircraft.calculated?.altitude) return undefined;
    const difference = Math.abs(aircraft.gs - aircraft.tas);
    let threshold = 100; // Default for high altitude
    if (aircraft.calculated.altitude < 10000)
        threshold = 50; // Lower threshold for low altitude
    else if (aircraft.calculated.altitude < 20000) threshold = 75; // Medium threshold for medium altitude
    if (difference > threshold)
        return {
            type: 'strong-winds',
            severity: aircraft.calculated.altitude < 10000 ? 'medium' : 'low',
            details: `${difference.toFixed(0)} kts GS/TAS difference`,
        };
    return undefined;
}

function detectTemperatureInversion(aircraft) {
    if (aircraft.oat === undefined || !aircraft.calculated?.altitude) return undefined;
    // Standard atmosphere temperature lapse rate is roughly 2°C per 1000ft
    const expectedTemp = 15 - (aircraft.calculated.altitude / 1000) * 2,
        tempDeviation = aircraft.oat - expectedTemp;
    // Significant temperature inversion or deviation
    if (Math.abs(tempDeviation) > 10)
        return {
            type: 'temperature-anomaly',
            severity: 'low',
            details: `${tempDeviation > 0 ? '+' : ''}${tempDeviation.toFixed(0)}°C from ISA`,
        };
    return undefined;
}

function detectWeatherHolding(aircraft) {
    if (!aircraft.calculated?.in_holding) return undefined;
    return {
        type: 'weather-holding',
        severity: 'medium',
        details: 'holding pattern in weather conditions',
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const severityRank = { high: 3, medium: 2, low: 1 };
const severityColors = { high: ' [HIGH]', medium: ' [MEDIUM]' };

module.exports = {
    id: 'weather',
    name: 'Aircraft Weather Operations',
    enabled: true,
    priority: 5,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.weatherHistory = {};
    },
    preprocess: (aircraft) => {
        aircraft.calculated.weather = { inWeatherOperation: false, conditions: [] };

        if (!aircraft.hex) return;

        if (!this.weatherHistory[aircraft.hex])
            this.weatherHistory[aircraft.hex] = {
                verticalRates: [],
                timestamps: [],
                lastUpdate: Date.now(),
            };
        const history = this.weatherHistory[aircraft.hex];
        const now = Date.now();

        if (aircraft.baro_rate !== undefined) {
            history.verticalRates.push(aircraft.baro_rate);
            history.timestamps.push(now);
        }

        const fiveMinutesAgo = now - 5 * 60 * 1000;
        const oldestValidIndex = history.timestamps.findIndex((ts) => ts >= fiveMinutesAgo);
        if (oldestValidIndex > 0) {
            history.verticalRates = history.verticalRates.slice(oldestValidIndex);
            history.timestamps = history.timestamps.slice(oldestValidIndex);
        }

        const conditions = [
            //detectIcingConditions(aircraft),
            //detectSeverIcingRisk(aircraft),
            detectTurbulence(history.verticalRates),
            detectStrongWinds(aircraft),
            detectTemperatureInversion(aircraft),
        ].filter(Boolean);

        if (conditions.length > 0) {
            const condition = detectWeatherHolding(aircraft);
            if (condition) conditions.push(condition);
        }

        if (conditions.length > 0)
            aircraft.calculated.weather = {
                inWeatherOperation: true,
                conditions,
                highestSeverity: conditions.reduce(
                    (highest, current) => (severityRank[current.severity] > severityRank[highest] ? current.severity : highest),
                    'low'
                ),
            };

        history.lastUpdate = now;
        const thirtyMinutesAgo = now - 30 * 60 * 1000;
        Object.keys(this.weatherHistory)
            .filter((hex) => this.weatherHistory[hex].lastUpdate < thirtyMinutesAgo)
            .forEach((hex) => delete this.weatherHistory[hex]);
    },
    evaluate: (aircraft) => aircraft.calculated.weather.inWeatherOperation,
    sort: (a, b) => severityRank[b.calculated.weather.highestSeverity] - severityRank[a.calculated.weather.highestSeverity],
    getStats: (aircrafts) => {
        const list = aircrafts.filter((a) => a.calculated.weather.inWeatherOperation);
        const byCondition = list
            .flatMap((a) => a.calculated.weather.conditions.map((c) => c.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const bySeverity = list
            .map((a) => a.calculated.weather.highestSeverity)
            .reduce((counts, severity) => ({ ...counts, [severity]: (counts[severity] || 0) + 1 }), {});
        return {
            ...this.extra.format.getStats_List('aircraft-weather', list),
            byCondition,
            bySeverity,
            highSeverityCount: bySeverity.high || 0,
            mediumSeverityCount: bySeverity.medium || 0,
            lowSeverityCount: bySeverity.low || 0,
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
