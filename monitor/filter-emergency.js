// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// filter-emergency.js - Enhanced emergency detection with ADS-B emergency/priority status
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');
const { compareSeverity } = require('./filter-common.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Emergency status definitions based on ADS-B spec (Table 2.2.3.2.7.8.1.1)
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const EMERGENCY_STATUS = {
    // Status definitions with severity levels
    none: {
        code: 0,
        severity: undefined,
        description: 'No Emergency',
    },
    general: {
        code: 1,
        severity: 'critical',
        description: 'General Emergency',
        type: 'general_emergency',
    },
    lifeguard: {
        code: 2,
        severity: 'high',
        description: 'Medical Emergency',
        type: 'medical_emergency',
    },
    minfuel: {
        code: 3,
        severity: 'high',
        description: 'Minimum Fuel',
        type: 'minimum_fuel',
    },
    nordo: {
        code: 4,
        severity: 'medium',
        description: 'No Communications',
        type: 'radio_failure',
    },
    unlawful: {
        code: 5,
        severity: 'critical',
        description: 'Unlawful Interference',
        type: 'hijack',
    },
    downed: {
        code: 6,
        severity: 'critical',
        description: 'Downed Aircraft',
        type: 'downed_aircraft',
    },
    reserved: {
        code: 7,
        severity: 'high',
        description: 'Reserved',
        type: 'reserved_emergency',
    },
};

// Emergency type priorities for sorting
const emergencyTypePriority = {
    downed_aircraft: 0,
    hijack: 1,
    general_emergency: 2,
    medical_emergency: 3,
    minimum_fuel: 4,
    radio_failure: 5,
    reserved_emergency: 6,
    emergency_squawk: 7,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectEmergency(conf, aircraft) {
    const emergency = {
        hasEmergency: false,
        type: undefined,
        code: undefined,
        severity: 'info',
        source: undefined,
        description: undefined,
    };

    // 1. Check ADS-B emergency field (most reliable)
    if (aircraft.emergency && aircraft.emergency !== 'none') {
        const statusInfo = EMERGENCY_STATUS[aircraft.emergency];
        if (statusInfo && statusInfo.severity) {
            emergency.hasEmergency = true;
            emergency.type = statusInfo.type;
            emergency.code = aircraft.emergency;
            emergency.severity = statusInfo.severity;
            emergency.source = 'adsb_status';
            emergency.description = statusInfo.description;

            // Special handling for certain types
            if (aircraft.emergency === 'nordo' && aircraft.squawk === '7600') {
                emergency.source = 'both'; // Both ADS-B and squawk confirm
                emergency.severity = 'high'; // Upgrade severity when confirmed
            }

            return emergency;
        }
    }

    // 2. Check emergency squawk codes (fallback for non-ADS-B or older transponders)
    if (aircraft.squawk && conf.emergencySquawks.includes(aircraft.squawk)) {
        emergency.hasEmergency = true;
        emergency.source = 'squawk';

        switch (aircraft.squawk) {
            case '7500':
                emergency.type = 'hijack';
                emergency.code = '7500';
                emergency.severity = 'critical';
                emergency.description = 'Hijack';
                break;
            case '7600':
                emergency.type = 'radio_failure';
                emergency.code = '7600';
                emergency.severity = 'medium';
                emergency.description = 'Radio Failure';
                // Check if ADS-B confirms
                if (aircraft.emergency === 'nordo') {
                    emergency.source = 'both';
                    emergency.severity = 'high';
                }
                break;
            case '7700':
                emergency.type = 'general_emergency';
                emergency.code = '7700';
                emergency.severity = 'critical';
                emergency.description = 'General Emergency';
                break;
            default:
                emergency.type = 'emergency_squawk';
                emergency.code = aircraft.squawk;
                emergency.severity = 'high';
                emergency.description = `Emergency Squawk ${aircraft.squawk}`;
        }

        return emergency;
    }

    // 3. Check for mismatches (potential issues): aircraft has emergency squawk but ADS-B says "none"
    if (aircraft.emergency === 'none' && aircraft.squawk && conf.emergencySquawks.includes(aircraft.squawk)) {
        emergency.hasEmergency = true;
        emergency.type = 'emergency_mismatch';
        emergency.code = aircraft.squawk;
        emergency.severity = 'medium';
        emergency.source = 'mismatch';
        emergency.description = `Squawk ${aircraft.squawk} but no ADS-B emergency`;
        return emergency;
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'emergency',
    name: 'Aircraft emergency detection',
    priority: 1,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.conf.emergencySquawks = this.conf.emergencySquawks || ['7500', '7600', '7700'];
        this.conf.detectMismatches = this.conf.detectMismatches !== false;

        console.error(`filter-emergency: configured with ${this.conf.emergencySquawks.length} squawk codes, mismatch detection: ${this.conf.detectMismatches ? 'enabled' : 'disabled'}`);
    },
    preprocess: (aircraft) => {
        aircraft.calculated.emergency = { hasEmergency: false };
        const emergency = detectEmergency(this.conf, aircraft);
        if (emergency) aircraft.calculated.emergency = emergency;
    },
    evaluate: (aircraft) => aircraft.calculated.emergency.hasEmergency,
    sort: (a, b) => {
        const a_ = a.calculated.emergency;
        const b_ = b.calculated.emergency;

        // First sort by severity
        const severityDiff = compareSeverity(a_, b_);
        if (severityDiff !== 0) return severityDiff;

        // Then by source reliability (adsb_status > both > squawk > mismatch)
        const sourceOrder = { adsb_status: 0, both: 1, squawk: 2, mismatch: 3 };
        const aSource = sourceOrder[a_.source] ?? 99;
        const bSource = sourceOrder[b_.source] ?? 99;
        if (aSource !== bSource) return aSource - bSource;

        // Finally by emergency type
        const aType = emergencyTypePriority[a_.type] ?? 99;
        const bType = emergencyTypePriority[b_.type] ?? 99;
        return aType - bType;
    },
    getStats: (aircrafts, list) => {
        const byType = {};
        const bySeverity = {};
        const bySource = {};
        const byStatus = {};

        list.forEach((aircraft) => {
            const { emergency } = aircraft.calculated;

            // Type stats
            byType[emergency.type] = (byType[emergency.type] || 0) + 1;

            // Severity stats
            bySeverity[emergency.severity] = (bySeverity[emergency.severity] || 0) + 1;

            // Source stats
            bySource[emergency.source] = (bySource[emergency.source] || 0) + 1;

            // ADS-B status stats
            if (aircraft.emergency && aircraft.emergency !== 'none') {
                byStatus[aircraft.emergency] = (byStatus[aircraft.emergency] || 0) + 1;
            }
        });

        return {
            total: list.length,
            byType,
            bySeverity,
            bySource,
            byStatus,
            critical: bySeverity.critical || 0,
            high: bySeverity.high || 0,
            medium: bySeverity.medium || 0,
        };
    },
    format: (aircraft) => {
        const { emergency } = aircraft.calculated;
        let text = '';

        // Build main text based on type
        switch (emergency.type) {
            case 'hijack':
                text = aircraft.emergency === 'unlawful' ? 'UNLAWFUL INTERFERENCE' : 'HIJACK - SQUAWK 7500';
                break;
            case 'radio_failure':
                text = aircraft.emergency === 'nordo' ? 'NO RADIO (NORDO)' : 'RADIO FAILURE - SQUAWK 7600';
                break;
            case 'general_emergency':
                text = aircraft.emergency === 'general' ? 'GENERAL EMERGENCY' : 'EMERGENCY - SQUAWK 7700';
                break;
            case 'medical_emergency':
                text = 'MEDICAL EMERGENCY (LIFEGUARD)';
                break;
            case 'minimum_fuel':
                text = 'MINIMUM FUEL';
                break;
            case 'downed_aircraft':
                text = 'DOWNED AIRCRAFT';
                break;
            case 'reserved_emergency':
                text = 'RESERVED EMERGENCY';
                break;
            case 'emergency_mismatch':
                text = emergency.description;
                break;
            default:
                text = emergency.description || `EMERGENCY ${emergency.code}`;
        }

        // Add source indicator if relevant
        if (emergency.source === 'both') {
            text += ' [CONFIRMED]';
        } else if (emergency.source === 'mismatch') {
            text += ' [CHECK]';
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
                source: emergency.source,
                adsbStatus: aircraft.emergency,
            },
        };
    },
    debug: (type, aircraft) => {
        if (type === 'sorting') {
            const e = aircraft.calculated.emergency;
            return `type=${e.type}, severity=${e.severity}, source=${e.source}, adsb=${aircraft.emergency}`;
        }
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
