// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class FlightHexcodeMappings {
    constructor(options = {}) {
        this.options = {
            filename: options.filename || '.monitor-hextoflight.cache',
            saveInterval: options.saveInterval || 5 * 60 * 1000, // 5 minutes
            expiryTime: options.expiryTime || 7 * 24 * 60 * 60 * 1000, // 7 days
            version: 1,
            autoSave: options.autoSave !== false,
            autoPersist: options.autoPersist !== false,
            debug: options.debug || false,
            logger: options.logger || console.error, // Default to console.error
        };

        // Maps
        this.hexToFlight = new Map();
        this.flightToHex = new Map();
        this.hexToTime = new Map();

        // State
        this.isDirty = false;
        this.saveTimer = undefined;
        this.stats = {
            loads: 0,
            saves: 0,
            hits: 0,
            misses: 0,
            updates: 0,
            cleanups: 0,
        };

        // Initialize
        this._initialize();
    }

    _initialize() {
        // Load existing cache
        if (this.options.autoPersist) {
            this.load();
        }

        // Setup auto-save
        if (this.options.autoSave && this.options.saveInterval > 0) {
            this.saveTimer = setInterval(() => {
                if (this.isDirty) {
                    this.save();
                }
            }, this.options.saveInterval);
            this.saveTimer.unref();
        }

        // Setup exit handlers
        if (this.options.autoPersist) process.once('exit', () => this.save());
    }

    // Core operations
    get(hex) {
        const flight = this.hexToFlight.get(hex);
        if (flight) {
            this.stats.hits++;
            return flight;
        }
        this.stats.misses++;
        return undefined;
    }

    set(hex, flight) {
        if (!hex || !flight) return false;

        const now = Date.now();
        const existingHex = this.flightToHex.get(flight);

        // Handle existing mappings
        if (existingHex && existingHex !== hex) {
            this.hexToFlight.delete(existingHex);
            this.hexToTime.delete(existingHex);
        }

        // Update mappings
        this.hexToFlight.set(hex, flight);
        this.flightToHex.set(flight, hex);
        this.hexToTime.set(hex, now);

        this.isDirty = true;
        this.stats.updates++;

        return true;
    }

    delete(hex) {
        const flight = this.hexToFlight.get(hex);
        if (!flight) return false;

        this.hexToFlight.delete(hex);
        this.hexToTime.delete(hex);

        if (this.flightToHex.get(flight) === hex) {
            this.flightToHex.delete(flight);
        }

        this.isDirty = true;
        return true;
    }

    // Batch operations
    updateBatch(entries) {
        let updated = 0;
        entries.forEach(({ hex, flight }) => {
            if (this.set(hex, flight)) updated++;
        });
        return updated;
    }

    // Process aircraft array
    processAircraft(aircraft) {
        if (!Array.isArray(aircraft)) return { replaced: 0, updated: 0 };

        let replaced = 0;
        let updated = 0;

        aircraft.forEach((ac) => {
            if (!ac.hex) return;

            // Update mapping if aircraft has flight number
            if (ac.flight && ac.flight.trim()) {
                ac.flight = ac.flight.trim();
                const existingFlight = this.hexToFlight.get(ac.hex);
                if (existingFlight !== ac.flight) {
                    this.set(ac.hex, ac.flight);
                    updated++;
                }
            }

            // Replace missing flight numbers
            if (!ac.flight || !ac.flight.trim()) {
                const mappedFlight = this.get(ac.hex);
                if (mappedFlight) {
                    ac.flight = mappedFlight;
                    replaced++;
                } else {
                    ac.flight = `[${ac.hex}]`;
                }
            }
        });

        return { replaced, updated };
    }

    // Maintenance
    cleanup() {
        const now = Date.now();
        const expiredTime = now - this.options.expiryTime;
        const expired = [];

        this.hexToTime.forEach((timestamp, hex) => {
            if (timestamp < expiredTime) {
                expired.push(hex);
            }
        });

        expired.forEach((hex) => this.delete(hex));

        this.stats.cleanups++;
        return expired.length;
    }

    // Persistence
    save() {
        if (!this.options.filename) return false;

        try {
            const data = {
                version: this.options.version,
                timestamp: Date.now(),
                mappings: Object.fromEntries(this.hexToFlight),
                timestamps: Object.fromEntries(this.hexToTime),
            };

            const dir = path.dirname(this.options.filename);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(this.options.filename, JSON.stringify(data, undefined, 2));
            this.isDirty = false;
            this.stats.saves++;

            if (this.options.debug) {
                this._log(`saved ${this.hexToFlight.size} mappings`);
            }

            return true;
        } catch (e) {
            this._log('save failed:', e.message);
            return false;
        }
    }

    load() {
        if (!this.options.filename) return false;

        try {
            if (!fs.existsSync(this.options.filename)) {
                return false;
            }

            const data = JSON.parse(fs.readFileSync(this.options.filename, 'utf8'));

            if (data.version !== this.options.version) {
                this._log('version mismatch, skipping load');
                return false;
            }

            // Clear existing
            this.hexToFlight.clear();
            this.flightToHex.clear();
            this.hexToTime.clear();

            // Load mappings
            Object.entries(data.mappings || {}).forEach(([hex, flight]) => {
                this.hexToFlight.set(hex, flight);
                if (!this.flightToHex.has(flight)) {
                    this.flightToHex.set(flight, hex);
                }
            });

            // Load timestamps
            Object.entries(data.timestamps || {}).forEach(([hex, timestamp]) => {
                this.hexToTime.set(hex, timestamp);
            });

            // Clean expired entries
            const cleaned = this.cleanup();

            this.isDirty = false;
            this.stats.loads++;

            if (this.options.debug) {
                this._log(`loaded ${this.hexToFlight.size} mappings, cleaned ${cleaned} expired`);
            }

            return true;
        } catch (e) {
            this._log('load failed:', e.message);
            return false;
        }
    }

    // Statistics
    getStats() {
        const now = Date.now();
        let oldest;
        let newest;

        this.hexToTime.forEach((timestamp, hex) => {
            if (!oldest || timestamp < oldest.timestamp) {
                oldest = { hex, timestamp, flight: this.hexToFlight.get(hex) };
            }
            if (!newest || timestamp > newest.timestamp) {
                newest = { hex, timestamp, flight: this.hexToFlight.get(hex) };
            }
        });

        return {
            mapSize: this.hexToFlight.size,
            uniqueFlights: this.flightToHex.size,
            ...this.stats,
            hitRate: this.stats.hits + this.stats.misses > 0 ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) + '%' : undefined,
            oldest: oldest
                ? {
                      ...oldest,
                      age: Math.round((now - oldest.timestamp) / 1000),
                      timestamp: new Date(oldest.timestamp).toISOString(),
                  }
                : undefined,
            newest: newest
                ? {
                      ...newest,
                      age: Math.round((now - newest.timestamp) / 1000),
                      timestamp: new Date(newest.timestamp).toISOString(),
                  }
                : undefined,
        };
    }

    // Utility
    clear() {
        this.hexToFlight.clear();
        this.flightToHex.clear();
        this.hexToTime.clear();
        this.isDirty = true;
    }

    destroy() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = undefined;
        }
        if (this.isDirty && this.options.autoPersist) {
            this.save();
        }
    }

    _log(...args) {
        this.options.logger('flights-hexcode-mappings:', ...args);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = FlightHexcodeMappings;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
