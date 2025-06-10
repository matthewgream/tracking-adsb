// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class SquawksData {
    constructor(options = {}) {
        this.options = {
            file: options.file || 'squawks.js', // Changed from 'squawks.json'
            directory: options.directory || '../content',
            validateCodes: options.validateCodes !== false,
            debug: options.debug || false,
            logger: options.logger || console.error, // Default to console.error
        };

        // Maps
        this.mapOfSquawks = new Map();
        this.mapOfTypes = new Map();

        // Stats
        this.stats = {
            total: 0,
            unique: 0,
            badEntries: 0,
            invalidCodes: 0,
            types: 0,
        };

        this._load();
    }

    _load() {
        try {
            const filepath = path.join(this.options.directory, this.options.file);
            let rawData;

            // Handle both .js and .json files
            if (this.options.file.endsWith('.js')) {
                // Check if file exists first
                if (!fs.existsSync(filepath)) {
                    throw new Error(`File not found: ${filepath}`);
                }

                // Get absolute path for require
                const absolutePath = path.resolve(filepath);

                // Clear require cache if exists
                if (require.cache[absolutePath]) {
                    delete require.cache[absolutePath];
                }

                try {
                    rawData = require(absolutePath);
                } catch (e) {
                    throw new Error(`Failed to require file: ${e.message}`);
                }
            } else {
                rawData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
            }

            if (!rawData.codes || !Array.isArray(rawData.codes)) {
                throw new Error('Invalid squawks data: missing or invalid codes array');
            }

            this._buildMaps(rawData.codes);

            if (this.options.debug) {
                this._log(`loaded ${this.stats.total} entries, ${this.stats.unique} unique codes, ${this.stats.types} types`);
            }
        } catch (e) {
            this._log('failed to load squawks data:', e.message);
            throw new Error(`Failed to load squawks data from ${this.options.file}: ${e.message}`);
        }
    }

    _isValidSquawkCode(code) {
        const codeStr = String(code).padStart(4, '0');
        return /^[0-7]{4}$/.test(codeStr);
    }

    _normalizeSquawkCode(code) {
        // Handle both string and number inputs
        let codeStr = String(code).trim();

        // Remove leading zeros for parsing
        const codeNum = Number.parseInt(codeStr, 10);
        if (Number.isNaN(codeNum) || codeNum < 0 || codeNum > 7777) {
            return { valid: false, error: 'Code must be between 0000 and 7777' };
        }

        // Validate format (must be valid octal)
        codeStr = codeNum.toString().padStart(4, '0');
        if (!this._isValidSquawkCode(codeStr)) {
            return { valid: false, error: 'Code must contain only digits 0-7' };
        }

        return { valid: true, code: codeNum };
    }

    _buildMaps(codes) {
        let badEntries = 0;
        let invalidCodes = 0;
        let totalEntries = 0;

        codes.forEach((entry) => {
            if (!entry.begin) {
                badEntries++;
                return;
            }

            const beginValidation = this._normalizeSquawkCode(entry.begin);
            if (!beginValidation.valid) {
                if (this.options.debug) {
                    this._log(`invalid begin code '${entry.begin}': ${beginValidation.error}`);
                }
                badEntries++;
                invalidCodes++;
                return;
            }
            const beginNum = beginValidation.code;

            let endNum = beginNum;
            if (entry.end) {
                const endValidation = this._normalizeSquawkCode(entry.end);
                if (!endValidation.valid) {
                    if (this.options.debug) {
                        this._log(`invalid end code '${entry.end}': ${endValidation.error}`);
                    }
                    badEntries++;
                    invalidCodes++;
                    return;
                }
                endNum = endValidation.code;
            }

            // Store normalized entry
            const normalizedEntry = {
                ...entry,
                beginNum,
                endNum,
            };

            // Populate squawk map
            for (let code = beginNum; code <= endNum; code++) {
                if (!this.mapOfSquawks.has(code)) {
                    this.mapOfSquawks.set(code, []);
                }
                this.mapOfSquawks.get(code).push(normalizedEntry);
                totalEntries++;
            }

            // Populate type map
            if (entry.type) {
                if (!this.mapOfTypes.has(entry.type)) {
                    this.mapOfTypes.set(entry.type, []);
                }
                this.mapOfTypes.get(entry.type).push(normalizedEntry);
            }
        });

        this.stats = {
            total: totalEntries,
            unique: this.mapOfSquawks.size,
            badEntries,
            invalidCodes,
            types: this.mapOfTypes.size,
        };

        if (badEntries > 0) {
            this._log(`pruned ${badEntries} bad entries`);
        }
    }

    // Public methods
    findByCode(code) {
        if (!code) return [];
        const validation = this._normalizeSquawkCode(code);
        if (!validation.valid) return [];
        return this.mapOfSquawks.get(validation.code) || [];
    }

    findByType(type) {
        if (!type) return [];
        return this.mapOfTypes.get(type) || [];
    }

    getAllTypes() {
        return new Set(this.mapOfTypes.keys());
    }

    getInfo() {
        const possible = 8 ** 4; // 8^4 for octal codes
        return `codes: possible=${possible}, unique=${this.stats.unique}, actual=${this.stats.total}, types: count=${this.stats.types}`;
    }

    getStats() {
        return {
            ...this.stats,
            possible: 8 ** 4,
        };
    }

    hasCode(code) {
        const validation = this._normalizeSquawkCode(code);
        return validation.valid && this.mapOfSquawks.has(validation.code);
    }

    hasType(type) {
        return type && this.mapOfTypes.has(type);
    }

    _log(...args) {
        this.options.logger('squawks-data:', ...args);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = SquawksData;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
