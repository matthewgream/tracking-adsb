// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectHighSpeedLowAltitude(aircraft) {
    if (!aircraft.gs || !aircraft.calculated?.altitude) return undefined;
    if (aircraft.gs > 400 && aircraft.calculated.altitude < 15000)
        return {
            type: 'high-speed-low-altitude',
            severity: 'medium',
            details: `${aircraft.gs.toFixed(0)} kts at ${aircraft.calculated.altitude.toFixed(0)} ft`,
        };
    return undefined;
}

function detectLowSpeedHighAltitude(aircraft) {
    if (!aircraft.gs || !aircraft.calculated?.altitude) return undefined;
    if (aircraft.gs < 250 && aircraft.calculated.altitude > 30000)
        return {
            type: 'low-speed-high-altitude',
            severity: 'medium',
            details: `${aircraft.gs.toFixed(0)} kts at ${aircraft.calculated.altitude.toFixed(0)} ft`,
        };
    return undefined;
}

function detectTemperatureAnomaly(aircraft) {
    if (aircraft.oat === undefined || aircraft.tat === undefined || !aircraft.mach) return undefined;
    const expectedTempDiff = aircraft.mach * aircraft.mach * 40,
        actualTempDiff = aircraft.tat - aircraft.oat;
    if (Math.abs(actualTempDiff - expectedTempDiff) > 20)
        return {
            type: 'temperature-anomaly',
            severity: 'low',
            details: `OAT ${aircraft.oat}°C, TAT ${aircraft.tat}°C, Mach ${aircraft.mach.toFixed(2)}`,
        };
    return undefined;
}

function detectAltitudeOscillation(altitudes) {
    if (!altitudes || altitudes.length < 5) return undefined;
    const altChangeDirections = [];
    for (let i = 1; i < altitudes.length; i++)
        if (Math.abs(altitudes[i] - altitudes[i - 1]) > 300) altChangeDirections.push(altitudes[i] - altitudes[i - 1] > 0 ? 'up' : 'down');
    let directionChanges = 0;
    for (let i = 1; i < altChangeDirections.length; i++) if (altChangeDirections[i] !== altChangeDirections[i - 1]) directionChanges++;
    const maxAlt = Math.max(...altitudes),
        minAlt = Math.min(...altitudes),
        altVariation = maxAlt - minAlt;
    if (directionChanges >= 2 && altVariation > 2000)
        return {
            type: 'altitude-oscillation',
            severity: 'medium',
            details: `${directionChanges} direction changes, ${altVariation.toFixed(0)} ft range`,
        };
    return undefined;
}

function detectAltitudeDeviation(aircraft, recentAltitudes) {
    if (!aircraft.nav_altitude_mcp || !aircraft.calculated?.altitude || !recentAltitudes || recentAltitudes.length < 5) return undefined;
    const assignedAlt = aircraft.nav_altitude_mcp,
        currentAlt = aircraft.calculated.altitude;
    const wasAtAssigned = recentAltitudes.some((alt) => Math.abs(alt - assignedAlt) < 300),
        deviation = Math.abs(currentAlt - assignedAlt);
    if (wasAtAssigned && deviation > 800 && deviation < 3000)
        return {
            type: 'altitude-deviation',
            severity: 'medium',
            details: `${deviation.toFixed(0)} ft deviation from assigned ${assignedAlt} ft`,
        };
    return undefined;
}

function detectExtremeVerticalRate(aircraft) {
    if (!aircraft.baro_rate) return undefined;
    const absRate = Math.abs(aircraft.baro_rate);
    if (absRate > 6000)
        return {
            type: 'extreme-vertical-rate',
            severity: 'medium',
            details: `${aircraft.baro_rate > 0 ? '+' : '-'}${absRate.toFixed(0)} ft/min`,
        };
    return undefined;
}

function detectRapidVerticalRateChange(aircraft, verticalRates) {
    if (!aircraft.baro_rate || !verticalRates || verticalRates.length < 3) return undefined;
    const currentRate = verticalRates[verticalRates.length - 1],
        prevRate = verticalRates[verticalRates.length - 3],
        rateChange = Math.abs(currentRate - prevRate);
    if (rateChange > 2000)
        return {
            type: 'vertical-rate-change',
            //severity: aircraft.nav_modes && aircraft.nav_modes.includes('tcas') ? 'high' : 'medium',
            severity: 'medium',
            details: `${rateChange.toFixed(0)} ft/min change${aircraft.nav_modes && aircraft.nav_modes.includes('tcas') ? ' (TCAS active)' : ''}`,
        };
    return undefined;
}

function detectRapidSpeedChange(speeds) {
    if (!speeds || speeds.length < 3) return undefined;
    const currentSpeed = speeds[speeds.length - 1],
        [prevSpeed] = speeds,
        speedChange = Math.abs(currentSpeed - prevSpeed);
    if (speedChange > 100)
        return {
            type: 'rapid-speed-change',
            severity: 'low',
            details: `${speedChange.toFixed(0)} knots in ${speeds.length} updates`,
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const severityRank = { high: 3, medium: 2, low: 1 };
const severityColors = { high: ' [HIGH]', medium: ' [MEDIUM]' };

module.exports = {
    id: 'anomaly',
    name: 'Aircraft Operational Anomalies',
    enabled: true,
    priority: 4,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.trackHistory = {};
    },
    preprocess: (aircraft) => {
        aircraft.calculated.anomaly = { hasAnomaly: false, anomalies: [] };
        if (!aircraft.hex) return;
        if (!this.trackHistory[aircraft.hex])
            this.trackHistory[aircraft.hex] = {
                positions: [],
                altitudes: [],
                verticalRates: [],
                speeds: [],
                timestamps: [],
                lastUpdate: Date.now(),
            };
        const history = this.trackHistory[aircraft.hex];
        const now = Date.now();
        if (aircraft.calculated?.altitude !== undefined) {
            history.altitudes.push(aircraft.calculated.altitude);
            history.timestamps.push(now);
        }
        if (aircraft.baro_rate !== undefined) history.verticalRates.push(aircraft.baro_rate);
        if (aircraft.gs !== undefined) history.speeds.push(aircraft.gs);
        if (aircraft.lat !== undefined && aircraft.lon !== undefined) history.positions.push({ lat: aircraft.lat, lon: aircraft.lon, timestamp: now });
        const tenMinutesAgo = now - 10 * 60 * 1000;
        const oldestIndex = history.timestamps.findIndex((ts) => ts >= tenMinutesAgo);
        if (oldestIndex === -1) {
            history.altitudes = [];
            history.timestamps = [];
        } else {
            history.altitudes = history.altitudes.slice(oldestIndex);
            history.timestamps = history.timestamps.slice(oldestIndex);
        }
        history.verticalRates = history.verticalRates.slice(-20); // Keep last 20 readings
        history.speeds = history.speeds.slice(-20); // Keep last 20 readings
        history.positions = history.positions.filter((pos) => pos.timestamp >= tenMinutesAgo);
        history.lastUpdate = now;

        const anomalies = [
            detectHighSpeedLowAltitude(aircraft),
            detectLowSpeedHighAltitude(aircraft),
            detectTemperatureAnomaly(aircraft),
            detectAltitudeOscillation(history.altitudes),
            detectAltitudeDeviation(aircraft, history.altitudes),
            detectExtremeVerticalRate(aircraft),
            detectRapidVerticalRateChange(aircraft, history.verticalRates),
            detectRapidSpeedChange(history.speeds),
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
    postprocess: () => {
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
        Object.keys(this.trackHistory)
            .filter((hex) => this.trackHistory[hex].lastUpdate < thirtyMinutesAgo)
            .forEach((hex) => delete this.trackHistory[hex]);
    },
    evaluate: (aircraft) => aircraft.calculated.anomaly.hasAnomaly,
    sort: (a, b) => {
        a = a.calculated.anomaly;
        b = b.calculated.anomaly;
        return severityRank[b.highestSeverity] - severityRank[a.highestSeverity];
    },
    getStats: (aircrafts) => {
        const list = aircrafts.filter((a) => a.calculated.anomaly.hasAnomaly);
        const byType = list
            .flatMap((a) => a.calculated.anomaly.anomalies.map((t) => t.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const bySeverity = list
            .map((a) => a.calculated.anomaly.highestSeverity)
            .reduce((counts, severity) => ({ ...counts, [severity]: (counts[severity] || 0) + 1 }), {});
        return {
            ...this.extra.format.formatStatsList('aircraft-anomaly', list),
            byType,
            bySeverity,
            highSeverityCount: bySeverity.high || 0,
            mediumSeverityCount: bySeverity.medium || 0,
            lowSeverityCount: bySeverity.low || 0,
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
