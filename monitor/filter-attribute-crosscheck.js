// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Cross-field anomaly detection module for filter-attribute
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = { ...require('./tools-formats.js'), ...require('./tools-geometry.js') };

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const MILITARY_AIRPORT_PATTERNS = {
    name: [
        /\bRAF\b/i, // Royal Air Force
        /\bAFB\b/i, // Air Force Base
        /\bNAS\b/i, // Naval Air Station
        /\bMCAS\b/i, // Marine Corps Air Station
        /\bAAF\b/i, // Army Air Field
        /\bCFB\b/i, // Canadian Forces Base
        /Base Aérienne/i, // French
        /Fliegerhorst/i, // German
    ],
};

function isNearMilitaryAirport(aircraft, airports, distance = tools.nmToKm(5).value) {
    if (aircraft.lat === undefined || aircraft.lon === undefined) return false;
    const nearby = airports?.findNearby(aircraft.lat, aircraft.lon, { distance });
    return nearby?.some((airport) => MILITARY_AIRPORT_PATTERNS.name.some((pattern) => pattern.test(airport.name)));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const CROSSCHECK_DETECTORS = [
    // ===== Hexcode-Callsign Cross-checks =====
    {
        name: 'militaryHexCivilianCallsign',
        fields: ['hex', 'flight'],
        description: 'Military hex with civilian airline callsign',
        detect: (conf, aircraft, context) => {
            if (!aircraft.hex || !aircraft.flight) return undefined;

            // Check if hex matches military pattern from context
            const hexMatches = context.matches?.filter((m) => m.detector === 'hexcode' && m.category === 'military');
            if (!hexMatches?.length) return undefined;

            // Check if callsign looks like civilian airline
            if (/^[A-Z]{3}\d{1,4}$/.test(aircraft.flight)) {
                return {
                    type: 'military-hex-civilian-callsign',
                    severity: 'high',
                    confidence: 0.8,
                    description: 'Military hexcode with airline callsign',
                    details: `Military hex ${aircraft.hex} using civilian callsign ${aircraft.flight}`,
                    fields: ['hex', 'flight'],
                    values: { hex: aircraft.hex, flight: aircraft.flight },
                };
            }
            return undefined;
        },
    },

    {
        name: 'hexCountryCallsignMismatch',
        fields: ['hex', 'flight'],
        description: 'Hexcode country does not match callsign origin',
        detect: (conf, aircraft, context) => {
            if (!aircraft.hex || !aircraft.flight) return undefined;

            const hexMatch = context.matches?.find((m) => m.detector === 'hexcode');
            if (!hexMatch?.metadata?.country) return undefined;

            // Simple check for US airlines with non-US hex
            const usAirlines = ['AAL', 'UAL', 'DAL', 'SWA', 'ASA', 'JBU', 'NKS', 'FFT', 'SCX'];
            const callsignPrefix = aircraft.flight.slice(0, 3);

            if (usAirlines.includes(callsignPrefix) && !['US', 'A'].includes(hexMatch.metadata.country)) {
                return {
                    type: 'hex-country-callsign-mismatch',
                    severity: 'medium',
                    confidence: 0.7,
                    description: 'Hexcode country mismatch with airline',
                    details: `${hexMatch.metadata.country} hex with US airline ${callsignPrefix}`,
                    fields: ['hex', 'flight'],
                    values: { hex: aircraft.hex, flight: aircraft.flight, country: hexMatch.metadata.country },
                };
            }
            return undefined;
        },
    },

    // ===== Hexcode-Squawk Cross-checks =====
    {
        name: 'civilianHexMilitarySquawk',
        fields: ['hex', 'squawk'],
        description: 'Civilian hex with military squawk code',
        detect: (conf, aircraft, context) => {
            if (!aircraft.hex || !aircraft.squawk) return undefined;

            const hexMatch = context.matches?.find((m) => m.detector === 'hexcode' && m.category === 'civilian');
            const squawkMatch = context.matches?.find((m) => m.detector === 'squawk' && m.category === 'military');

            if (hexMatch && squawkMatch && !isNearMilitaryAirport(aircraft, context.extra.data.airports)) {
                // XXX radius
                return {
                    type: 'civilian-hex-military-squawk',
                    severity: 'medium',
                    confidence: 0.7,
                    description: 'Civilian aircraft using military squawk',
                    details: `Civilian hex ${aircraft.hex} with military squawk ${aircraft.squawk}`,
                    fields: ['hex', 'squawk'],
                    values: { hex: aircraft.hex, squawk: aircraft.squawk },
                };
            }
            return undefined;
        },
    },

    {
        name: 'testHexEmergencySquawk',
        fields: ['hex', 'squawk'],
        description: 'Test registration with emergency squawk',
        detect: (conf, aircraft, context) => {
            if (!aircraft.hex || !aircraft.squawk) return undefined;

            const hexMatch = context.matches?.find((m) => m.detector === 'hexcode' && m.category === 'test');
            const emergencySquawks = ['7500', '7600', '7700'];

            if (hexMatch && emergencySquawks.includes(aircraft.squawk)) {
                return {
                    type: 'test-hex-emergency-squawk',
                    severity: 'high',
                    confidence: 0.9,
                    description: 'Test aircraft squawking emergency',
                    details: `Test hex ${aircraft.hex} squawking ${aircraft.squawk}`,
                    fields: ['hex', 'squawk'],
                    values: { hex: aircraft.hex, squawk: aircraft.squawk },
                };
            }
            return undefined;
        },
    },

    // ===== Callsign-Squawk Cross-checks =====
    {
        name: 'hemsCallsignWrongSquawk',
        fields: ['flight', 'squawk'],
        description: 'HEMS callsign without HEMS squawk',
        detect: (conf, aircraft, context) => {
            if (!aircraft.flight || !aircraft.squawk) return undefined;

            const callsignMatch = context.matches?.find((m) => m.detector === 'callsign' && m.category === 'emergency-services' && m.description?.includes('ambulance'));

            const squawkMatch = context.matches?.find((m) => m.detector === 'squawk' && m.metadata?.squawkType === 'hems');

            if (callsignMatch && !squawkMatch && aircraft.squawk !== '0020') {
                return {
                    type: 'hems-callsign-wrong-squawk',
                    severity: 'low',
                    confidence: 0.6,
                    description: 'Air ambulance without HEMS squawk',
                    details: `HEMS flight ${aircraft.flight} using squawk ${aircraft.squawk}`,
                    fields: ['flight', 'squawk'],
                    values: { flight: aircraft.flight, squawk: aircraft.squawk },
                };
            }
            return undefined;
        },
    },

    {
        name: 'militaryCallsignCivilianSquawk',
        fields: ['flight', 'squawk'],
        description: 'Military callsign with civilian conspicuity',
        detect: (conf, aircraft, context) => {
            if (!aircraft.flight || !aircraft.squawk) return undefined;

            const militaryCallsign = context.matches?.find((m) => m.detector === 'callsign' && m.category === 'military');

            const conspicuitySquawks = ['7000', '2000', '1200'];

            if (militaryCallsign && conspicuitySquawks.includes(aircraft.squawk)) {
                return {
                    type: 'military-callsign-conspicuity-squawk',
                    severity: 'medium',
                    confidence: 0.7,
                    description: 'Military aircraft on conspicuity code',
                    details: `Military flight ${aircraft.flight} on conspicuity ${aircraft.squawk}`,
                    fields: ['flight', 'squawk'],
                    values: { flight: aircraft.flight, squawk: aircraft.squawk },
                };
            }
            return undefined;
        },
    },

    // ===== Category-based Cross-checks =====
    {
        name: 'categorySpeedMismatch',
        fields: ['category', 'gs'],
        description: 'Aircraft category incompatible with ground speed',
        detect: (conf, aircraft, _context) => {
            if (!aircraft.category || !aircraft.gs) return undefined;

            // Define speed limits by category
            const categorySpeedLimits = {
                A1: { min: 20, max: 200 }, // Light aircraft
                A2: { min: 40, max: 300 }, // Medium aircraft
                A3: { min: 60, max: 400 }, // Large aircraft
                A4: { min: 80, max: 500 }, // Heavy B757
                A5: { min: 80, max: 600 }, // Heavy aircraft
                A7: { min: 0, max: 200 }, // Rotorcraft
                B1: { min: 0, max: 150 }, // Glider
                B4: { min: 0, max: 120 }, // Ultralight
                B6: { min: 0, max: 150 }, // UAV
                C1: { min: 0, max: 80 }, // Surface emergency
                C2: { min: 0, max: 80 }, // Surface service
            };

            const limits = categorySpeedLimits[aircraft.category];
            if (!limits) return undefined;

            // Only check if significantly outside limits
            if (aircraft.gs > limits.max * 1.5) {
                return {
                    type: 'category-overspeed',
                    severity: 'medium',
                    confidence: 0.8,
                    description: 'Aircraft exceeding category speed limit',
                    details: `${tools.formatCategoryCode(aircraft.category)} at ${aircraft.gs}kts (max ~${limits.max}kts)`,
                    fields: ['category', 'gs'],
                    values: { category: aircraft.category, gs: aircraft.gs },
                };
            }

            // Check for helicopters flying too fast
            if (aircraft.category === 'A7' && aircraft.gs > 180) {
                return {
                    type: 'helicopter-overspeed',
                    severity: 'high',
                    confidence: 0.9,
                    description: 'Helicopter at fixed-wing speeds',
                    details: `Rotorcraft at ${aircraft.gs}kts`,
                    fields: ['category', 'gs'],
                    values: { category: aircraft.category, gs: aircraft.gs },
                };
            }

            return undefined;
        },
    },

    {
        name: 'categoryAltitudeMismatch',
        fields: ['category', 'alt_baro'],
        description: 'Aircraft category incompatible with altitude',
        detect: (conf, aircraft, _context) => {
            if (!aircraft.category || !aircraft.alt_baro) return undefined;

            // Light aircraft and ultralights shouldn't be at jet altitudes
            if (['A1', 'B4'].includes(aircraft.category) && aircraft.alt_baro > 25000) {
                return {
                    type: 'light-aircraft-high-altitude',
                    severity: 'high',
                    confidence: 0.8,
                    description: 'Light aircraft at jet altitude',
                    details: `${tools.formatCategoryCode(aircraft.category)} at FL${Math.round(aircraft.alt_baro / 100)}`,
                    fields: ['category', 'alt_baro'],
                    values: { category: aircraft.category, alt_baro: aircraft.alt_baro },
                };
            }

            // Surface vehicles shouldn't have altitude
            if (['C1', 'C2'].includes(aircraft.category) && aircraft.alt_baro > 200) {
                return {
                    type: 'surface-vehicle-airborne',
                    severity: 'high',
                    confidence: 0.9,
                    description: 'Surface vehicle reporting altitude',
                    details: `Surface vehicle at ${aircraft.alt_baro}ft`,
                    fields: ['category', 'alt_baro'],
                    values: { category: aircraft.category, alt_baro: aircraft.alt_baro },
                };
            }

            return undefined;
        },
    },

    {
        name: 'callsignCategoryMismatch',
        fields: ['flight', 'category'],
        description: 'Callsign type incompatible with aircraft category',
        detect: (conf, aircraft, _context) => {
            if (!aircraft.flight || !aircraft.category) return undefined;

            // Helicopter callsigns on fixed-wing
            if (/^(?:HELI|LIFE|HEMS|HEL)\d/.test(aircraft.flight) && aircraft.category !== 'A7') {
                return {
                    type: 'helicopter-callsign-fixed-wing',
                    severity: 'medium',
                    confidence: 0.7,
                    description: 'Helicopter callsign on fixed-wing',
                    details: `${aircraft.flight} on ${tools.formatCategoryCode(aircraft.category)}`,
                    fields: ['flight', 'category'],
                    values: { flight: aircraft.flight, category: aircraft.category },
                };
            }

            // Glider callsigns on powered aircraft
            if (/^(?:GLID|GLI|COMP)\d/.test(aircraft.flight) && !['B1', 'B4'].includes(aircraft.category)) {
                return {
                    type: 'glider-callsign-powered-aircraft',
                    severity: 'medium',
                    confidence: 0.7,
                    description: 'Glider callsign on powered aircraft',
                    details: `${aircraft.flight} on ${tools.formatCategoryCode(aircraft.category)}`,
                    fields: ['flight', 'category'],
                    values: { flight: aircraft.flight, category: aircraft.category },
                };
            }

            return undefined;
        },
    },

    // ===== Data Quality Cross-checks =====
    {
        name: 'invalidHexWithOperationalData',
        fields: ['hex', 'flight', 'squawk'],
        description: 'Invalid hex but has operational data',
        detect: (conf, aircraft, _context) => {
            if (!aircraft.hex) return undefined;

            const invalidHexPatterns = ['000000', 'FFFFFF', '123456', 'ABCDEF'];

            if (invalidHexPatterns.includes(aircraft.hex.toUpperCase()) && (aircraft.flight || aircraft.squawk)) {
                return {
                    type: 'invalid-hex-operational-data',
                    severity: 'high',
                    confidence: 0.9,
                    description: 'Invalid hexcode with operational data',
                    details: `Hex ${aircraft.hex} but has flight/squawk data`,
                    fields: ['hex', 'flight', 'squawk'],
                    values: {
                        hex: aircraft.hex,
                        flight: aircraft.flight || 'none',
                        squawk: aircraft.squawk || 'none',
                    },
                };
            }
            return undefined;
        },
    },

    // {
    //     name: 'hexAsCallsign',
    //     fields: ['hex', 'flight'],
    //     description: 'Using hexcode as callsign',
    //     detect: (conf, aircraft, _context) => {
    //         if (!aircraft.hex || !aircraft.flight) return undefined;

    //         // Check if callsign is just the hex in brackets
    //         if (aircraft.flight === `[${aircraft.hex}]` || aircraft.flight === aircraft.hex) {
    //             return {
    //                 type: 'hex-as-callsign',
    //                 severity: 'low',
    //                 confidence: 1,
    //                 description: 'No callsign assigned',
    //                 details: `Using hex ${aircraft.hex} as callsign`,
    //                 fields: ['hex', 'flight'],
    //                 values: { hex: aircraft.hex, flight: aircraft.flight },
    //             };
    //         }
    //         return undefined;
    //     },
    // },

    // ===== Emergency Status Cross-checks =====
    {
        name: 'emergencySquawkNormalOps',
        fields: ['squawk', 'baro_rate', 'track'],
        description: 'Emergency squawk but normal operations',
        detect: (conf, aircraft, _context) => {
            if (!aircraft.squawk) return undefined;

            const emergencySquawks = ['7500', '7600', '7700'];

            if (emergencySquawks.includes(aircraft.squawk) && aircraft.baro_rate !== undefined && Math.abs(aircraft.baro_rate) < 500 && aircraft.track_rate !== undefined && Math.abs(aircraft.track_rate) < 3) {
                return {
                    type: 'emergency-squawk-stable-flight',
                    severity: 'medium',
                    confidence: 0.6,
                    description: 'Emergency squawk in stable flight',
                    details: `Squawking ${aircraft.squawk} but flying normally`,
                    fields: ['squawk', 'baro_rate', 'track_rate'],
                    values: {
                        squawk: aircraft.squawk,
                        baro_rate: aircraft.baro_rate,
                        track_rate: aircraft.track_rate,
                    },
                };
            }
            return undefined;
        },
    },
];

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function getFieldUsageStats() {
    const fieldUsage = {};

    CROSSCHECK_DETECTORS.forEach((detector) => {
        detector.fields.forEach((field) => {
            if (!fieldUsage[field]) {
                fieldUsage[field] = {
                    count: 0,
                    detectors: [],
                };
            }
            fieldUsage[field].count++;
            fieldUsage[field].detectors.push(detector.name);
        });
    });

    return fieldUsage;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'crosscheck',
    name: 'Cross-field anomaly detection',

    config: (conf, extra, categories) => {
        this.conf = conf || {};
        this.extra = extra;
        this.categories = categories;

        // Store detector configuration
        this.detectors = CROSSCHECK_DETECTORS;

        // Log configuration
        const fieldSummary = Object.entries(getFieldUsageStats()).map(([field, stats]) => `${field}=${stats.count}`);

        console.error(`filter-attribute-crosscheck: configured: fields=${fieldSummary.length} (${fieldSummary.join(', ')})`);
    },

    getDetectors: () => CROSSCHECK_DETECTORS.map((detector) => (aircraft, context) => detector.detect(this.conf, aircraft, context)),
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
