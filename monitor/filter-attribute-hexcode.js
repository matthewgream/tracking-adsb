// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Hexcode (Mode-S) based attribute aircraft detection module
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = require('./tools-formats.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// Default patterns if no file is loaded
const DEFAULT_HEXCODE_PATTERNS = [
    // Military/Government ranges by country
    { pattern: '^43C[0-9A-F]{3}$', category: 'military', description: 'UK Military', country: 'UK' },
    { pattern: '^3F[8-F][0-9A-F]{3}$', category: 'military', description: 'German Military', country: 'DE' },
    { pattern: '^3A[8-F][0-9A-F]{3}$', category: 'military', description: 'French Military', country: 'FR' },
    { pattern: '^ADF[0-9A-F]{3}$', category: 'military', description: 'US Military', country: 'US' },
    { pattern: '^AE[0-9A-F]{4}$', category: 'military', description: 'US Military', country: 'US' },
];

// Specific individual aircraft by hexcode
const DEFAULT_SPECIAL_HEXCODES = [
    // Royal/VIP aircraft
    { hexcode: '400F01', category: 'royalty', description: 'Royal Air Force VIP', confidence: 1 },
    { hexcode: '3C6666', category: 'government', description: 'German Government', confidence: 1 },
    { hexcode: '3C0101', category: 'government', description: 'German Air Force One', confidence: 1 },

    // Famous/Historic
    { hexcode: 'A4FF71', category: 'historic', description: 'Historic Military Aircraft', confidence: 0.9 },
];

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function parseDAT(content) {
    if (content === undefined) return undefined;
    const lines = content.split('\n').filter((line) => line.trim());
    const entries = [];

    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 3) {
            entries.push({
                code: parts[0].trim(),
                description: parts[1].trim(),
                binaryPattern: parts[2].trim(),
            });
        }
    }

    return entries;
}

function parseModeSPrefixData(data) {
    if (!data || !Array.isArray(data)) return [];

    const patterns = [];

    for (const entry of data) {
        if (!entry.code || !entry.description || !entry.binaryPattern) continue;

        // Convert binary pattern to hex pattern
        const hexPattern = binaryPatternToHexRegex(entry.binaryPattern);
        if (!hexPattern) continue;

        // Determine category based on code suffix and description
        let category = 'civilian';
        let desc = entry.description;
        let confidence = 0.7;

        if (entry.code.endsWith('M') || entry.description.includes(' Mil')) {
            category = 'military';
            desc = entry.description;
            confidence = 0.9;
        } else if (entry.description.includes('NATO')) {
            category = 'military';
            desc = entry.description;
            confidence = 0.95;
        } else if (entry.code === 'IC' || entry.description.includes('ICAO')) {
            category = 'special-ops';
            desc = entry.description;
            confidence = 0.8;
        } else if (entry.description.includes('Not Allocated')) {
            continue; // Skip unallocated ranges
        }

        // Extract country code
        let country = entry.code;
        if (country.length > 2) {
            // For military codes like "USM", extract base country "US"
            country = country.slice(0, 2);
        }

        patterns.push({
            code: entry.code,
            pattern: hexPattern,
            category,
            description: desc,
            country,
            confidence,
            originalBinary: entry.binaryPattern,
        });
    }

    return patterns;
}

function binaryPatternToHexRegex(binaryPattern) {
    // Remove any spaces in the binary pattern
    binaryPattern = binaryPattern.replaceAll(/\s/g, '');

    // Binary pattern uses '-' for wildcards
    // We need to convert 24-bit binary to 6-digit hex regex

    if (binaryPattern.length !== 24) return undefined;

    let hexRegex = '^';

    // Process 4 bits at a time to create hex digits
    for (let i = 0; i < 24; i += 4) {
        const fourBits = binaryPattern.slice(i, i + 4);
        if (fourBits === '----') {
            hexRegex += '[0-9A-F]';
        } else if (fourBits.includes('-')) {
            // Partial wildcard - need to calculate possible hex values
            const possibleValues = calculatePossibleHexValues(fourBits);
            if (possibleValues.length === 1) {
                hexRegex += possibleValues[0];
            } else if (possibleValues.length > 1) {
                hexRegex += '[' + possibleValues.join('') + ']';
            }
        } else {
            // Fixed binary value - convert to hex
            hexRegex += Number.parseInt(fourBits, 2).toString(16).toUpperCase();
        }
    }
    hexRegex += '$';
    return hexRegex;
}

function calculatePossibleHexValues(fourBits) {
    const values = new Set();

    // Generate all possible combinations
    const generateCombinations = (pattern, index = 0, current = '') => {
        if (index === pattern.length) {
            values.add(Number.parseInt(current, 2).toString(16).toUpperCase());
            return;
        }
        if (pattern[index] === '-') {
            generateCombinations(pattern, index + 1, current + '0');
            generateCombinations(pattern, index + 1, current + '1');
        } else {
            generateCombinations(pattern, index + 1, current + pattern[index]);
        }
    };

    generateCombinations(fourBits);
    return [...values].sort();
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectHexcodePatterns(conf, aircraft, _categories) {
    const matches = [];

    if (!aircraft.hex) return matches;

    const hexUpper = aircraft.hex.toUpperCase();

    // Check specific hexcodes first (highest confidence)
    if (conf.specialHexcodes) {
        const special = conf.specialHexcodes.find((h) => h.hexcode === hexUpper);
        if (special) {
            matches.push({
                detector: 'hexcode',
                field: 'hex',
                pattern: 'exact-match',
                category: special.category,
                description: special.description,
                confidence: special.confidence || 1,
                value: aircraft.hex,
                metadata: special.metadata,
            });
        }
    }

    // Check hexcode patterns
    if (conf.patterns) {
        for (const pattern of conf.patterns) {
            if (pattern.regex.test(hexUpper)) {
                matches.push({
                    detector: 'hexcode',
                    field: 'hex',
                    pattern: pattern.pattern,
                    category: pattern.category,
                    description: pattern.description,
                    confidence: pattern.confidence || 0.8,
                    value: aircraft.hex,
                    metadata: {
                        country: pattern.country,
                        code: pattern.code,
                    },
                });
                break; // Only match first pattern to avoid duplicates
            }
        }
    }

    // Check custom watchlist
    if (conf.watchlist && conf.watchlist.includes(hexUpper)) {
        matches.push({
            detector: 'hexcode',
            field: 'hex',
            pattern: 'watchlist',
            category: 'special-interest',
            description: 'Watchlist aircraft',
            confidence: 1,
            value: aircraft.hex,
        });
    }

    return matches;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function validateHexcode(hex) {
    // Mode-S hexcodes are 6 characters, 0-9 and A-F
    return /^[\da-f]{6}$/i.test(hex);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectInvalidHexcode(aircraft, _context) {
    if (!aircraft.hex) return undefined;

    const hex = aircraft.hex.toUpperCase();

    // Check if it's not a valid 6-character hex
    if (!validateHexcode(hex)) {
        return {
            type: 'hexcode-invalid-format',
            severity: 'high',
            confidence: 1,
            description: `Invalid hexcode format: "${hex}"`,
            details: `Mode-S code must be exactly 6 hexadecimal characters`,
            field: 'hex',
            value: hex,
        };
    }

    // Check for all zeros
    if (hex === '000000') {
        return {
            type: 'hexcode-all-zeros',
            severity: 'high',
            confidence: 1,
            description: `Invalid all-zero hexcode`,
            details: `Mode-S code 000000 is not valid`,
            field: 'hex',
            value: hex,
        };
    }

    // Check for all Fs
    if (hex === 'FFFFFF') {
        return {
            type: 'hexcode-all-fs',
            severity: 'high',
            confidence: 1,
            description: `Invalid all-F hexcode`,
            details: `Mode-S code FFFFFF is reserved`,
            field: 'hex',
            value: hex,
        };
    }

    return undefined;
}

function detectUnallocatedHexcode(aircraft, context) {
    if (!aircraft.hex || !context.matches) return undefined;

    const hex = aircraft.hex.toUpperCase();
    const matches = context.matches.filter((m) => m.detector === 'hexcode');

    // If no matches and we have patterns loaded, it might be unallocated
    if (matches.length === 0 && this.conf && this.conf.patterns && this.conf.patterns.length > 100) {
        // Only flag as unallocated if we have a comprehensive pattern list
        return {
            type: 'hexcode-unallocated',
            severity: 'medium',
            confidence: 0.7,
            description: `Possibly unallocated hexcode`,
            details: `Hexcode ${hex} doesn't match any known allocation patterns`,
            field: 'hex',
            value: hex,
        };
    }

    return undefined;
}

function detectHexcodePatternAnomaly(aircraft, context) {
    if (!aircraft.hex) return undefined;

    const hex = aircraft.hex.toUpperCase();
    const anomalies = [];

    // Check for sequential patterns (might indicate spoofing)
    if (/(.)\1{3,}/.test(hex)) {
        anomalies.push({
            type: 'hexcode-repetitive-pattern',
            severity: 'medium',
            confidence: 0.8,
            description: `Suspicious repetitive pattern in hexcode`,
            details: `Hexcode ${hex} contains unusual repetitive digits`,
            field: 'hex',
            value: hex,
        });
    }

    // Check for test patterns
    if (/^(?:123456|abcdef|a{6}|[\da-f]0{5})$/i.test(hex)) {
        anomalies.push({
            type: 'hexcode-test-pattern',
            severity: 'low',
            confidence: 0.9,
            description: `Test pattern hexcode`,
            details: `Hexcode ${hex} appears to be a test or placeholder value`,
            field: 'hex',
            value: hex,
        });
    }

    // Check if matches civilian pattern but has military indicators
    if (context.matches?.some((m) => m.category === 'civilian')) {
        if (aircraft.calculated?.military?.isMilitary) {
            anomalies.push({
                type: 'hexcode-civilian-military-mismatch',
                severity: 'medium',
                confidence: 0.6,
                description: `Civilian hexcode with military indicators`,
                details: `Aircraft shows military characteristics but uses civilian hex range`,
                field: 'hex',
                value: hex,
            });
        }
    }

    return anomalies.length > 0 ? anomalies : undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'hexcode',
    name: 'Hexcode (Mode-S) pattern detection',

    config: (conf, extra, categories) => {
        this.conf = conf || {};
        this.extra = extra;
        this.categories = categories;

        // Load Mode-S prefix file if specified
        let loadedPatterns = [];

        let text;
        if (this.conf.modeSPrefixFile && extra.data?.loader) {
            const prefixData = parseDAT(extra.data.loader.load(this.conf.modeSPrefixFile));
            if (prefixData) {
                loadedPatterns = parseModeSPrefixData(prefixData);
                text = `'${this.conf.modeSPrefixFile}' loaded ${loadedPatterns.length} entries`;
            } else {
                console.error(`filter-attribute-hexcode: mode-s patterns load failure, using '${this.conf.modeSPrefixFile}'`);
            }
        }

        // Merge loaded patterns with configured patterns
        if (loadedPatterns.length > 0) {
            const configuredPatterns = this.conf.patterns || [];
            this.conf.patterns = [...loadedPatterns, ...configuredPatterns];
        } else {
            this.conf.patterns = this.conf.patterns || DEFAULT_HEXCODE_PATTERNS;
        }

        // Compile patterns to regex
        this.conf.patterns = this.conf.patterns.map((p) => ({
            ...p,
            regex: new RegExp(p.pattern, 'i'),
        }));

        // Set up special hexcodes
        this.conf.specialHexcodes = this.conf.specialHexcodes || DEFAULT_SPECIAL_HEXCODES;

        // Set up watchlist (array of hexcodes to watch)
        this.conf.watchlist = this.conf.watchlist || [];

        // Validate watchlist hexcodes
        this.conf.watchlist = this.conf.watchlist
            .filter((hex) => {
                if (!validateHexcode(hex)) {
                    console.error(`filter-attribute-hexcode: invalid hexcode in watchlist: ${hex}`);
                    return false;
                }
                return true;
            })
            .map((hex) => hex.toUpperCase());

        // Log some statistics
        if (this.conf.patterns.length > 0) console.error(`filter-attribute-hexcode: configured: ${tools.formatKeyCounts(this.conf.patterns, 'category')}${text ? ' [' + text + ']' : ''}`);
    },

    detect: (conf, aircraft, categories) => detectHexcodePatterns(this.conf, aircraft, categories),

    detectors: [detectInvalidHexcode, detectUnallocatedHexcode, detectHexcodePatternAnomaly],

    // Optional preprocessing
    preprocess: (aircraft, _context) => {
        // Validate and normalize hexcode
        if (aircraft.hex && validateHexcode(aircraft.hex)) {
            aircraft.calculated._normalizedHex = aircraft.hex.toUpperCase();
        }
    },

    // Utility function to add aircraft to watchlist dynamically
    addToWatchlist: (hexcode) => {
        if (validateHexcode(hexcode)) {
            const hex = hexcode.toUpperCase();
            if (!this.conf.watchlist.includes(hex)) {
                this.conf.watchlist.push(hex);
                return true;
            }
        }
        return false;
    },

    // Utility function to remove from watchlist
    removeFromWatchlist: (hexcode) => {
        const hex = hexcode.toUpperCase();
        const index = this.conf.watchlist.indexOf(hex);
        if (index !== -1) {
            this.conf.watchlist.splice(index, 1);
            return true;
        }
        return false;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
