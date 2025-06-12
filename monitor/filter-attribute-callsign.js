// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Callsign-based attribute aircraft detection module
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = require('./tools-formats.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const DEFAULT_MILITARY_PREFIXES = [
    'RCH',
    'PLF',
    'RRR',
    'ASY',
    'RFF',
    'HVK',
    'CFC',
    'HRZ',
    'EEF',
    'FNF',
    'BAF',
    'GAF',
    'GAM',
    'RFR',
    'NVY',
    'CNV',
    'CHD',
    'DOD',
    'AAC',
    'SHF',
    'SUI',
    'SVF',
    'AME',
    'SIV',
    'SQF',
    'ROF',
    'AFP',
    'PNY',
    'NOW',
    'KIW',
    'NAF',
    'LAF',
    'IFC',
    'HUF',
    'HAF',
    'FAF',
    'FMY',
    'FNY',
    'DAF',
    'CEF',
    'ASF',
    'RSD',
    'IAM',
    'AFB',
    'CXG',
    'MMF',
    'AYB',
    'NOH',
    'WAD',
    'PAT',
    'UNO',
    'RSF',
    'DNY',
    'AIO',
    'UAF',
    'QID',
];

const DEFAULT_PATTERNS = [
    // Royalty
    { pattern: '^(TKF)[0-9]', category: 'royalty', description: "The King's Flight" },
    { pattern: '^(KRF)[0-9]', category: 'royalty', description: 'Royal Flight' },

    // Government
    { pattern: '^(EXEC|STATE|GOV)[0-9]', category: 'government', description: 'Government flight' },
    { pattern: '^CAF', category: 'government', description: 'Canadian Air Force' },
    { pattern: '^RRF', category: 'government', description: 'French Republic flight' },
    { pattern: '^IAF', category: 'government', description: 'Italian Air Force' },
    { pattern: '^SAF', category: 'government', description: 'Swedish Air Force' },

    // Military
    { prefixes: DEFAULT_MILITARY_PREFIXES, category: 'military', description: 'Military (Prefix)', confidence: 0.9 },
    { pattern: '^[A-Z]{4}[0-9]{2}$', category: 'military', description: 'Military (4-letter ICAO)', confidence: 0.8 },
    { pattern: '^[A-Z]{5}[0-9]{2}$', category: 'military', description: 'Military (5-letter tactical)', confidence: 0.9 },

    // Special operators
    { pattern: '^(CKS|CPT)', category: 'special-ops', description: 'Special operations' },
    { pattern: '^(DUKE|ASCOT|REACH|ROCKY)', category: 'military-transport', description: 'Military transport' },

    // Test flights
    { pattern: '^(N|D|G|F|HB)-[A-Z]{3}$', category: 'test', description: 'Possible test flight (short code)' },
    { pattern: '^(TEST|XCL|XCH|XAS)', category: 'test', description: 'Test flight' },
    { pattern: '^(BOE)[0-9]', category: 'test', description: 'Boeing test flight' },
    { pattern: '^(AIB)[0-9]', category: 'test', description: 'Airbus test flight' },

    // Emergency services
    { pattern: '^(HEMS|HELIMED|RESCUE)', category: 'emergency-services', description: 'Air ambulance' },
    { pattern: '^(POLICE|NPAS)', category: 'emergency-services', description: 'Police aircraft' },
    { pattern: '^(COAST)', category: 'emergency-services', description: 'Coast Guard' },

    // Survey and monitoring
    { pattern: '^(PIPELINE|SURVEY)', category: 'survey', description: 'Aerial survey' },
    { pattern: '^(PHOTO|CAMERA)', category: 'survey', description: 'Aerial photography' },

    // Special interest
    { pattern: '^(RETRO|HISTORIC|WARBIRD)', category: 'historic', description: 'Historic aircraft' },
    { pattern: '^(NASA)', category: 'special-interest', description: 'NASA aircraft' },
];

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectCallsignPatterns(conf, aircraft) {
    const matches = [];

    if (!aircraft.flight || !conf.patterns) return matches;

    for (const pattern of conf.patterns) {
        if (pattern.regex)
            if (pattern.regex.test(aircraft.flight))
                matches.push({
                    detector: 'callsign',
                    field: 'flight',
                    pattern: pattern.pattern,
                    category: pattern.category,
                    description: pattern.description,
                    confidence: pattern.confidence || 1,
                    value: aircraft.flight,
                });

        if (pattern.prefixes)
            for (const prefix of pattern.prefixes)
                if (aircraft.flight.startsWith(prefix))
                    matches.push({
                        detector: 'callsign',
                        field: 'flight',
                        pattern: `^${prefix}`,
                        category: pattern.category,
                        description: pattern.description,
                        confidence: pattern.confidence || 1,
                        value: aircraft.flight,
                    });
    }

    return matches;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectMalformedCallsign(conf, aircraft) {
    if (!aircraft.flight) return undefined;

    const { flight } = aircraft;

    // Check for empty or too short
    if (flight.length < 2) {
        return {
            type: 'callsign-too-short',
            severity: 'high',
            confidence: 1,
            description: `Callsign too short: "${flight}"`,
            details: `Callsign must be at least 2 characters`,
            field: 'flight',
            value: flight,
        };
    }

    // Check for invalid characters (Skip synthetic additions like [c07b42], [4d227d])
    // eslint-disable-next-line unicorn/better-regex
    if (!/^\[[\da-f]+\]$/i.test(flight) && !/^[\da-z-]+$/i.test(flight)) {
        return {
            type: 'callsign-invalid-chars',
            severity: 'medium',
            confidence: 0.9,
            description: `Invalid characters in callsign: "${flight}"`,
            details: `Callsign contains non-alphanumeric characters`,
            field: 'flight',
            value: flight,
        };
    }

    return undefined;
}

function detectCallsignFormatAnomaly(conf, aircraft) {
    if (!aircraft.flight || aircraft.flight.length < 3) return undefined;

    const flight = aircraft.flight.toUpperCase();
    const anomalies = [];

    // Check for mixed format (registration + flight number)
    if (/^[A-Z]-[A-Z]{3,4}\d+$/.test(flight)) {
        anomalies.push({
            type: 'callsign-mixed-format',
            severity: 'medium',
            confidence: 0.8,
            description: `Mixed registration/flight format`,
            details: `Callsign appears to mix registration and flight number formats`,
            field: 'flight',
            value: flight,
        });
    }

    // Check for all numbers (except specific patterns like "1234")
    if (/^\d+$/.test(flight) && flight.length > 4) {
        anomalies.push({
            type: 'callsign-all-numeric',
            severity: 'medium',
            confidence: 0.7,
            description: `All-numeric callsign`,
            details: `Unusual all-numeric callsign: ${flight}`,
            field: 'flight',
            value: flight,
        });
    }

    // Check for suspiciously long callsign
    if (flight.length > 10) {
        anomalies.push({
            type: 'callsign-too-long',
            severity: 'low',
            confidence: 0.6,
            description: `Unusually long callsign`,
            details: `Callsign length ${flight.length} exceeds typical maximum`,
            field: 'flight',
            value: flight,
        });
    }

    return anomalies.length > 0 ? anomalies : undefined;
}

function detectCallsignPatternMismatch(conf, aircraft, context) {
    if (!aircraft.flight || !context.matches) return undefined;

    const flight = aircraft.flight.toUpperCase();
    const matches = context.matches.filter((m) => m.detector === 'callsign');

    // Check if military callsign format but didn't match any military pattern
    if (/^[A-Z]{4}\d{2}$/.test(flight) && !matches.some((m) => m.category === 'military')) {
        // Looks like military format but didn't match known prefixes
        return {
            type: 'callsign-unknown-military-format',
            severity: 'low',
            confidence: 0.5,
            description: `Unknown military-style callsign`,
            details: `Callsign ${flight} follows military format but uses unknown prefix`,
            field: 'flight',
            value: flight,
        };
    }

    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const CALLSIGN_DETECTORS = [detectMalformedCallsign, detectCallsignFormatAnomaly, detectCallsignPatternMismatch];

module.exports = {
    id: 'callsign',
    name: 'Callsign pattern detection',

    config: (conf, extra, categories) => {
        this.conf = conf || {};
        this.extra = extra;
        this.categories = categories;

        this.conf.patterns = (this.conf.patterns || DEFAULT_PATTERNS).map((p) => ({
            ...p,
            regex: p.pattern ? new RegExp(p.pattern, 'i') : undefined,
        }));

        console.error(`filter-attribute-callsign: configured: patterns=${this.conf.patterns.length} (${tools.formatKeyCounts(this.conf.patterns, 'category')})`);
    },

    detect: (_conf, aircraft, _categories) => detectCallsignPatterns(this.conf, aircraft),

    getDetectors: () => CALLSIGN_DETECTORS.map((detector) => (aircraft, context) => detector(this.conf, aircraft, context)),

    // Optional preprocessing if needed for this detector
    preprocess: (aircraft, _context) => {
        // Callsign detector might normalize flight numbers here if needed
        if (aircraft.flight) {
            aircraft.calculated._normalizedFlight = aircraft.flight.trim().toUpperCase();
        }
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
