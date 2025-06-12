// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// filter-emergency.js - High confidence emergency detection with severity levels
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');
const { compareSeverity } = require('./filter-common.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const emergencyTypes = {
    declared: 0,
    general_emergency: 1,
    hijack: 2,
    radio_failure: 3,
    emergency_squawk: 4,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectEmergency(conf, aircraft) {
    const emergency = {
        hasEmergency: false,
        type: undefined,
        code: undefined,
        severity: 'info',
    };

    // 1. Check explicit emergency field
    if (aircraft.emergency && aircraft.emergency !== 'none') {
        emergency.hasEmergency = true;
        emergency.type = 'declared';
        emergency.code = aircraft.emergency;
        emergency.severity = 'critical'; // Declared emergencies are critical
        return emergency;
    }

    // 2. Check emergency squawk codes
    if (aircraft.squawk && conf.emergencySquawks.includes(aircraft.squawk)) {
        emergency.hasEmergency = true;

        // Assign severity based on squawk type
        switch (aircraft.squawk) {
            case '7500':
                emergency.type = 'hijack';
                emergency.code = '7500';
                emergency.severity = 'high'; // Hijack is high but not critical (needs verification)
                break;
            case '7600':
                emergency.type = 'radio_failure';
                emergency.code = '7600';
                emergency.severity = 'medium'; // Radio failure is concerning but less urgent
                break;
            case '7700':
                emergency.type = 'general_emergency';
                emergency.code = '7700';
                emergency.severity = 'critical'; // General emergency is critical
                break;
            default:
                emergency.type = 'emergency_squawk';
                emergency.code = aircraft.squawk;
                emergency.severity = 'high'; // Unknown emergency codes default to high
        }
        return emergency;
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'emergency',
    name: 'Aircraft in emergency',
    priority: 1,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.conf.emergencySquawks = this.conf.emergencySquawks || ['7500', '7600', '7700'];
    },
    preprocess: (aircraft) => {
        aircraft.calculated.emergency = { hasEmergency: false };
        const emergency = detectEmergency(this.conf, aircraft);
        if (emergency) aircraft.calculated.emergency = emergency;
    },
    evaluate: (aircraft) => aircraft.calculated.emergency.hasEmergency,
    sort: (a, b) => {
        const severityDiff = compareSeverity(a.calculated.emergency, b.calculated.emergency);

        if (severityDiff !== 0) return severityDiff;

        const aType = emergencyTypes[a.calculated.emergency.type] ?? 99;
        const bType = emergencyTypes[b.calculated.emergency.type] ?? 99;

        return aType - bType;
    },
    getStats: (aircrafts, list) => {
        const byType = {};
        const bySeverity = {};

        list.forEach((aircraft) => {
            const { emergency } = aircraft.calculated;
            byType[emergency.type] = (byType[emergency.type] || 0) + 1;
            bySeverity[emergency.severity] = (bySeverity[emergency.severity] || 0) + 1;
        });

        return {
            total: list.length,
            byType,
            bySeverity,
            critical: bySeverity.critical || 0,
            high: bySeverity.high || 0,
            medium: bySeverity.medium || 0,
        };
    },
    format: (aircraft) => {
        const { emergency } = aircraft.calculated;
        let text = '';

        switch (emergency.type) {
            case 'hijack':
                text = `HIJACK - SQUAWK 7500`;
                break;
            case 'radio_failure':
                text = `RADIO FAILURE - SQUAWK 7600`;
                break;
            case 'general_emergency':
                text = `EMERGENCY - SQUAWK 7700`;
                break;
            case 'declared':
                text = `EMERGENCY DECLARED - ${emergency.code.toUpperCase()}`;
                break;
            default:
                text = `EMERGENCY SQUAWK ${emergency.code}`;
        }

        // Add severity indicator
        text = `[${emergency.severity.toUpperCase()}] ${text}`;

        return {
            text,
            warn: true, // All emergencies are warnings
            emergency: {
                type: emergency.type,
                code: emergency.code,
                severity: emergency.severity,
            },
        };
    },
    debug: (type, aircraft) => {
        if (type === 'sorting') {
            const e = aircraft.calculated.emergency;
            return `type=${e.type}, severity=${e.severity}, code=${e.code}`;
        }
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
