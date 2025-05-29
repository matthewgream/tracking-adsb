// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const DEFAULT_TYPE_PRIORITIES = {
    emergency: 1,
    sar: 1,
    hems: 2,
    police: 2,
    royal: 2,
    government: 3,
    military: 3,
    special: 4,
    danger_area: 4,
    display: 5,
    helicopter: 6,
    monitoring: 7,
    conspicuity: 8,
    approach: 9,
    tower: 9,
    radar: 9,
    fis: 10,
    service: 10,
    training: 10,
    uas: 10,
    ifr: 11,
    domestic: 11,
    transit: 12,
    offshore: 12,
    assigned: 13,
    ground: 14,
};

const DEFAULT_CODE_PRIORITIES = {
    7500: 1, // Hijacking
    7600: 1, // Radio failure
    7700: 1, // Emergency
    '0023': 2, // SAR operations
    '0020': 2, // HEMS
    '0030': 3, // FIR Lost
    '0032': 3, // Police operations
    '0037': 3, // Royal flights
    7001: 4, // Military low level
    7002: 5, // Danger areas
    7003: 5, // Red Arrows
    7004: 5, // Aerobatics
    7400: 3, // UAS Lost Link
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectGroundTestingMismatch(aircraft, squawkMatches) {
    // Check if using ground testing code (0002) while airborne
    const groundTestingMatch = squawkMatches.find((match) => match.begin === '0002');
    if (groundTestingMatch && aircraft.calculated?.altitude > 500)
        return {
            type: 'ground-testing-airborne',
            severity: 'high',
            details: `Using ground testing code 0002 at ${aircraft.calculated.altitude} ft`,
            description: 'Ground transponder testing code used while airborne',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectMilitarySquawkMismatch(aircraft, squawkMatches) {
    // Check if using military squawk without military flight prefix
    const militarySquawk = squawkMatches.find(
        (match) => match.type === 'military' || (match.description && match.description.some((desc) => desc.toLowerCase().includes('military')))
    );
    if (militarySquawk && !aircraft.calculated?.is_military)
        return {
            type: 'military-squawk-civilian',
            severity: 'medium',
            details: `Military squawk ${aircraft.squawk} on apparent civilian flight`,
            description: 'Military transponder code on non-military callsign',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAltitudeMismatch(aircraft, _squawkMatches) {
    // Check VFR conspicuity (7000) above transition level
    if (aircraft.squawk === '7000' && aircraft.calculated?.altitude > 20000)
        return {
            type: 'vfr-high-altitude',
            severity: 'medium',
            details: `VFR conspicuity code at FL${Math.round(aircraft.calculated.altitude / 100)}`,
            description: 'VFR code at IFR altitude',
        };
    // Check IFR conspicuity (2000) at very low altitude
    if (aircraft.squawk === '2000' && aircraft.calculated?.altitude < 1000 && aircraft.calculated?.altitude > 0)
        return {
            type: 'ifr-low-altitude',
            severity: 'low',
            details: `IFR conspicuity code at ${aircraft.calculated.altitude} ft`,
            description: 'IFR code at very low altitude',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectEmergencySquawkWithoutEmergency(aircraft, squawkMatches) {
    // Check if squawking emergency without emergency flag
    const emergencySquawk = squawkMatches.find((match) => match.type === 'emergency' || ['7500', '7600', '7700'].includes(match.begin));
    if (emergencySquawk && !aircraft.calculated?.is_emergency)
        return {
            type: 'emergency-squawk-no-flag',
            severity: 'high',
            details: `Emergency squawk ${aircraft.squawk} without emergency status`,
            description: 'Emergency code without corresponding emergency flag',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectInappropriateSpecialUseCode(aircraft, squawkMatches) {
    // Check for special purpose codes that seem inappropriate
    const specialMatches = squawkMatches.filter((match) => match.type === 'special' || match.type === 'royal' || match.type === 'display');
    for (const match of specialMatches) {
        // Red Arrows code on slow aircraft
        if (match.begin === '7003' && aircraft.gs && aircraft.gs < 200)
            return {
                type: 'display-code-slow-aircraft',
                severity: 'medium',
                details: `Red Arrows display code at ${aircraft.gs} kts`,
                description: 'Display team code on slow aircraft',
            };
        // Royal flight code on high-altitude aircraft (royal flights typically lower)
        if (match.type === 'royal' && aircraft.calculated?.altitude > 30000)
            return {
                type: 'royal-code-high-altitude',
                severity: 'low',
                details: `Royal flight code at FL${Math.round(aircraft.calculated.altitude / 100)}`,
                description: 'Royal flight code at unusually high altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const severityRank = { high: 3, medium: 2, low: 1 };

module.exports = {
    id: 'squawks',
    name: 'Squawk code analysis',
    priority: 3,
    config: (conf, extra) => {
        this.conf = conf || {};
        this.extra = extra;
        this.squawkData = extra.data?.squawks;
        if (this.squawkData === undefined) console.error('filter-squawks: squawk data not available');
        this.typePriorities = this.conf.typePriorities || DEFAULT_TYPE_PRIORITIES;
        this.codePriorities = this.conf.codePriorities || DEFAULT_CODE_PRIORITIES;
        this.watchCodes = new Set(this.conf.watchCodes || Object.keys(DEFAULT_CODE_PRIORITIES));
        this.watchTypes = new Set(this.conf.watchTypes || ['emergency', 'sar', 'hems', 'police', 'royal', 'military', 'special']);
        this.detectAnomalies = this.conf.detectAnomalies !== false; // Default true
    },
    preprocess: (aircraft) => {
        aircraft.calculated.squawk = { code: aircraft.squawk, matches: [], isInteresting: false, anomalies: [] };
        if (aircraft.squawk === undefined || !this.squawkData) return;

        const matches = this.squawkData.findByCode(aircraft.squawk);
        aircraft.calculated.squawk.matches = matches;

        const isWatchedCode = this.watchCodes.has(aircraft.squawk);
        const hasWatchedType = matches.some((match) => this.watchTypes.has(match.type));
        aircraft.calculated.squawk.isInteresting = isWatchedCode || hasWatchedType;

        if (this.detectAnomalies && matches.length > 0) {
            const anomalies = [
                detectGroundTestingMismatch(aircraft, matches),
                detectMilitarySquawkMismatch(aircraft, matches),
                detectAltitudeMismatch(aircraft, matches),
                detectEmergencySquawkWithoutEmergency(aircraft, matches),
                detectInappropriateSpecialUseCode(aircraft, matches),
            ].filter(Boolean);
            if (anomalies.length > 0) {
                aircraft.calculated.squawk.anomalies = anomalies;
                aircraft.calculated.squawk.highestSeverity = anomalies.reduce(
                    (highest, current) => (severityRank[current.severity] > severityRank[highest] ? current.severity : highest),
                    'low'
                );
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.squawk.isInteresting || aircraft.calculated.squawk.anomalies.length > 0,
    sort: (a, b) => {
        const aSquawk = a.calculated.squawk,
            bSquawk = b.calculated.squawk;
        if (aSquawk.anomalies.length > 0 || bSquawk.anomalies.length > 0) {
            const aSeverity = severityRank[aSquawk.highestSeverity] || 0,
                bSeverity = severityRank[bSquawk.highestSeverity] || 0;
            if (aSeverity !== bSeverity) return bSeverity - aSeverity;
        }
        const aCodePriority = this.codePriorities[aSquawk.code] || 999,
            bCodePriority = this.codePriorities[bSquawk.code] || 999;
        if (aCodePriority !== bCodePriority) return aCodePriority - bCodePriority;
        const aTypePriority = Math.min(...aSquawk.matches.map((m) => this.typePriorities[m.type] || 999)),
            bTypePriority = Math.min(...bSquawk.matches.map((m) => this.typePriorities[m.type] || 999));
        if (aTypePriority !== bTypePriority) return aTypePriority - bTypePriority;
        return a.calculated.distance - b.calculated.distance;
    },
    getStats: (aircrafts, list) => {
        const byType = list
            .flatMap((a) => a.calculated.squawk.matches.map((m) => m.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const byCode = list.map((a) => a.calculated.squawk.code).reduce((counts, code) => ({ ...counts, [code]: (counts[code] || 0) + 1 }), {});
        const withAnomalies = list.filter((a) => a.calculated.squawk.anomalies.length > 0);
        const anomalyTypes = withAnomalies
            .flatMap((a) => a.calculated.squawk.anomalies.map((an) => an.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        return {
            total: list.length,
            byType,
            byCode,
            anomalyCount: withAnomalies.length,
            anomalyTypes,
        };
    },
    format: (aircraft) => {
        const { squawk } = aircraft.calculated;
        if (squawk.anomalies.length > 0) {
            const [primary] = squawk.anomalies,
                count = squawk.anomalies.length;
            const suffix = count > 1 ? ` (+${count - 1} more)` : '';
            const description = primary.description;
            return {
                text: `squawk ${squawk.code} anomaly: ${description}${suffix}`,
                warn: squawk.highestSeverity === 'high',
                squawkInfo: {
                    code: squawk.code,
                    anomalies: squawk.anomalies,
                    matches: squawk.matches,
                },
            };
        }
        if (squawk.matches.length > 0) {
            const [primary] = squawk.matches,
                count = squawk.matches.length;
            const suffix = count > 1 ? ` (+${count - 1} more)` : '';
            const description = primary.description?.[0] || primary.type || 'Unknown';
            return {
                text: `squawk ${squawk.code}: ${description}${suffix}`,
                warn: this.codePriorities[squawk.code] <= 3 || this.typePriorities[primary.type] <= 3,
                squawkInfo: {
                    code: squawk.code,
                    type: primary.type,
                    description,
                    matches: squawk.matches,
                },
            };
        }
        return {
            text: `squawk ${squawk.code}: unrecognized code`,
            warn: false,
            squawkInfo: { code: squawk.code },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
