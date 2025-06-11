// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const https = require('https');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class FlightHexcodeMappings {
    constructor(options = {}) {
        this.options = {
            filename: options.filename || '.monitor-hextoflight.cache',
            saveInterval: options.saveInterval || 5 * 60 * 1000, // 5 minutes
            expiryTime: options.expiryTime || 90 * 24 * 60 * 60 * 1000, // 90 days for local mappings
            onlineExpiryTime: options.onlineExpiryTime || 180 * 24 * 60 * 60 * 1000, // 180 days for online data
            version: 2, // Bumped version for new data structure
            autoSave: options.autoSave !== false,
            autoPersist: options.autoPersist !== false,
            debug: options.debug || false,
            logger: options.logger || console.error,

            // Online fetching options
            fetchOnline: options.fetchOnline !== false,
            fetchMode: options.fetchMode || 'missing', // 'missing', 'all', or 'none'
            fetchQueueInterval: options.fetchQueueInterval || 2000, // 2 seconds between fetches
            fetchBatchSize: options.fetchBatchSize || 10, // Max concurrent requests
            fetchRetries: options.fetchRetries || 2,
            fetchTimeout: options.fetchTimeout || 10000, // 10 seconds
            hexdbBaseUrl: options.hexdbBaseUrl || 'https://hexdb.io/api/v1/aircraft/',
        };

        // Maps
        this.hexToFlight = new Map();
        this.flightToHex = new Map();
        this.hexToTime = new Map();
        this.hexToData = new Map(); // Full aircraft data
        this.hexToSource = new Map(); // Track where data came from: 'local' or 'online'

        // Online fetching state
        this.fetchQueue = new Set();
        this.fetchInProgress = new Set();
        this.fetchTimer = undefined;
        this.fetchStats = {
            queued: 0,
            fetched: 0,
            failed: 0,
            errors: {},
        };

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
            onlineHits: 0,
            localHits: 0,
        };

        // Initialize
        this._initialize();
    }

    destroy() {
        this._stopFetchTimer();
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = undefined;
        }
        if (this.isDirty && this.options.autoPersist) {
            this.save();
        }
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

        // Setup online fetching
        if (this.options.fetchOnline && this.options.fetchMode !== 'none') {
            this._startFetchTimer();
        }

        // Setup exit handlers
        if (this.options.autoPersist) {
            process.once('exit', () => {
                if (this.isDirty) this.save();
                this._stopFetchTimer();
            });
        }
    }

    // Core operations
    get(hex) {
        const flight = this.hexToFlight.get(hex);
        if (flight) {
            this.stats.hits++;
            const source = this.hexToSource.get(hex);
            if (source === 'online') this.stats.onlineHits++;
            else this.stats.localHits++;
            return flight;
        }
        this.stats.misses++;

        // Queue for online fetch if enabled and not already queued/fetched
        if (this.options.fetchOnline && this.options.fetchMode !== 'none' && !this.fetchQueue.has(hex) && !this.fetchInProgress.has(hex) && !this.hexToData.has(hex)) {
            this._queueForFetch(hex);
        }

        return undefined;
    }

    getData(hex) {
        return this.hexToData.get(hex);
    }

    set(hex, flight, source = 'local', additionalData = undefined) {
        if (!hex || !flight) return false;

        const now = Date.now();
        const existingHex = this.flightToHex.get(flight);

        // Handle existing mappings
        if (existingHex && existingHex !== hex) {
            this.hexToFlight.delete(existingHex);
            this.hexToTime.delete(existingHex);
            this.hexToData.delete(existingHex);
            this.hexToSource.delete(existingHex);
        }

        // Update mappings
        this.hexToFlight.set(hex, flight);
        this.flightToHex.set(flight, hex);
        this.hexToTime.set(hex, now);
        this.hexToSource.set(hex, source);

        if (additionalData) {
            this.hexToData.set(hex, additionalData);
        }

        this.isDirty = true;
        this.stats.updates++;

        return true;
    }

    delete(hex) {
        const flight = this.hexToFlight.get(hex);
        if (!flight) return false;

        this.hexToFlight.delete(hex);
        this.hexToTime.delete(hex);
        this.hexToData.delete(hex);
        this.hexToSource.delete(hex);

        if (this.flightToHex.get(flight) === hex) {
            this.flightToHex.delete(flight);
        }

        this.isDirty = true;
        return true;
    }

    // Batch operations
    updateBatch(entries) {
        let updated = 0;
        entries.forEach(({ hex, flight, source, data }) => {
            if (this.set(hex, flight, source, data)) updated++;
        });
        return updated;
    }

    // Process aircraft array
    processAircraft(aircraft) {
        if (!Array.isArray(aircraft)) return { replaced: 0, updated: 0, queued: 0 };

        let replaced = 0;
        let updated = 0;
        let queued = 0;

        aircraft.forEach((ac) => {
            if (!ac.hex) return;

            // Update mapping if aircraft has flight number
            if (ac.flight && ac.flight.trim()) {
                ac.flight = ac.flight.trim();
                const existingFlight = this.hexToFlight.get(ac.hex);
                if (existingFlight !== ac.flight) {
                    this.set(ac.hex, ac.flight, 'local');
                    updated++;
                }
            }

            // Replace missing flight numbers
            if (!ac.flight || !ac.flight.trim()) {
                const mappedFlight = this.get(ac.hex); // This will queue for fetch if missing
                if (mappedFlight) {
                    ac.flight = mappedFlight;
                    replaced++;

                    // Also add any additional data we have
                    const additionalData = this.getData(ac.hex);
                    if (additionalData) {
                        ac.registration = additionalData.Registration;
                        ac.manufacturer = additionalData.Manufacturer;
                        ac.type = additionalData.Type;
                        ac.typeCode = additionalData.ICAOTypeCode;
                        ac.operator = additionalData.RegisteredOwners;
                    }
                } else {
                    ac.flight = `[${ac.hex}]`;
                    if (this.fetchQueue.has(ac.hex)) queued++;
                }
            }

            // Queue all hexes for fetch if mode is 'all'
            if (this.options.fetchMode === 'all' && !this.hexToData.has(ac.hex) && !this.fetchQueue.has(ac.hex) && !this.fetchInProgress.has(ac.hex)) {
                this._queueForFetch(ac.hex);
                queued++;
            }
        });

        return { replaced, updated, queued };
    }

    // Online fetching methods
    _queueForFetch(hex) {
        this.fetchQueue.add(hex);
        this.fetchStats.queued++;
    }

    _startFetchTimer() {
        if (this.fetchTimer) return;

        this.fetchTimer = setInterval(() => {
            this._processFetchQueue();
        }, this.options.fetchQueueInterval);
        this.fetchTimer.unref();
    }

    _stopFetchTimer() {
        if (this.fetchTimer) {
            clearInterval(this.fetchTimer);
            this.fetchTimer = undefined;
        }
    }

    async _processFetchQueue() {
        if (this.fetchQueue.size === 0 || this.fetchInProgress.size >= this.options.fetchBatchSize) {
            return;
        }

        const toFetch = [...this.fetchQueue].slice(0, this.options.fetchBatchSize - this.fetchInProgress.size);

        for (const hex of toFetch) {
            this.fetchQueue.delete(hex);
            this.fetchInProgress.add(hex);

            // Don't await here - let them run in parallel
            this._fetchHexData(hex).catch((e) => {
                if (this.options.debug) {
                    this._log(`fetch error for ${hex}:`, e.message);
                }
            });
        }
    }

    async _fetchHexData(hex, retries = 0) {
        // Check if we already have this data to avoid duplicate fetches
        if (this.hexToData.has(hex)) {
            this.fetchInProgress.delete(hex);
            return;
        }

        try {
            const data = await this._makeRequest(hex);

            if (data && data.ModeS) {
                // Extract flight number from registration or use registration as flight
                let flight = data.Registration || hex;

                // Store the full data
                this.set(hex, flight, 'online', data);
                this.fetchStats.fetched++;

                if (this.options.debug) {
                    this._log(`fetched ${hex}: ${flight} (${data.Type || 'Unknown'})`);
                }
            }
        } catch (e) {
            if (retries < this.options.fetchRetries) {
                // Retry after a delay
                setTimeout(
                    () => {
                        this._fetchHexData(hex, retries + 1);
                    },
                    (retries + 1) * 1000
                );
            } else {
                this.fetchStats.failed++;
                const errorKey = e.message || 'unknown';
                this.fetchStats.errors[errorKey] = (this.fetchStats.errors[errorKey] || 0) + 1;
            }
        } finally {
            this.fetchInProgress.delete(hex);
        }
    }

    _makeRequest(hex) {
        return new Promise((resolve, reject) => {
            const url = this.options.hexdbBaseUrl + hex.toLowerCase();

            const req = https.get(url, { timeout: this.options.fetchTimeout }, (res) => {
                let data = '';

                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error(`Invalid JSON: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
    }

    // Maintenance
    cleanup() {
        const now = Date.now();
        const expiredTimeLocal = now - this.options.expiryTime;
        const expiredTimeOnline = now - this.options.onlineExpiryTime;
        const expired = [];

        this.hexToTime.forEach((timestamp, hex) => {
            const source = this.hexToSource.get(hex) || 'local';
            const expiredTime = source === 'online' ? expiredTimeOnline : expiredTimeLocal;

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
                sources: Object.fromEntries(this.hexToSource),
                additionalData: Object.fromEntries(this.hexToData),
            };

            const dir = path.dirname(this.options.filename);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(this.options.filename, JSON.stringify(data, undefined, 2));
            this.isDirty = false;
            this.stats.saves++;

            if (this.options.debug) {
                this._log(`saved ${this.hexToFlight.size} mappings (${this.hexToData.size} with data)`);
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
            this.hexToSource.clear();
            this.hexToData.clear();

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

            // Load sources
            Object.entries(data.sources || {}).forEach(([hex, source]) => {
                this.hexToSource.set(hex, source);
            });

            // Load additional data
            Object.entries(data.additionalData || {}).forEach(([hex, additionalData]) => {
                this.hexToData.set(hex, additionalData);
            });

            // Clean expired entries
            const cleaned = this.cleanup();

            this.isDirty = false;
            this.stats.loads++;

            if (this.options.debug) {
                this._log(`loaded ${this.hexToFlight.size} mappings (${this.hexToData.size} with data), cleaned ${cleaned} expired`);
            }

            return true;
        } catch (e) {
            this._log('load failed:', e.message);
            return false;
        }
    }

    clear() {
        this.hexToFlight.clear();
        this.flightToHex.clear();
        this.hexToTime.clear();
        this.hexToSource.clear();
        this.hexToData.clear();
        this.fetchQueue.clear();
        this.isDirty = true;
    }

    //

    getInfo() {
        const stats = this.getStats();
        const fetchMode = this.options.fetchOnline ? this.options.fetchMode : 'disabled';
        const cacheInfo = stats.mapSize > 0 ? `${stats.mapSize} mappings (${stats.bySource.local}L/${stats.bySource.online}O), ${stats.withData} with data` : '0 mappings';
        const fetchInfo = this.options.fetchOnline ? `, fetch=${fetchMode}/${this.options.fetchBatchSize}@${this.options.fetchQueueInterval / 1000}s` : '';
        return `${cacheInfo}${fetchInfo}`;
    }

    getStats() {
        const now = Date.now();
        let oldest;
        let newest;
        let onlineCount = 0;
        let localCount = 0;

        this.hexToTime.forEach((timestamp, hex) => {
            const source = this.hexToSource.get(hex) || 'local';
            if (source === 'online') onlineCount++;
            else localCount++;

            if (!oldest || timestamp < oldest.timestamp) {
                oldest = { hex, timestamp, flight: this.hexToFlight.get(hex), source };
            }
            if (!newest || timestamp > newest.timestamp) {
                newest = { hex, timestamp, flight: this.hexToFlight.get(hex), source };
            }
        });

        return {
            mapSize: this.hexToFlight.size,
            uniqueFlights: this.flightToHex.size,
            withData: this.hexToData.size,
            bySource: { local: localCount, online: onlineCount },
            ...this.stats,
            hitRate: this.stats.hits + this.stats.misses > 0 ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) + '%' : undefined,
            fetch: {
                queued: this.fetchQueue.size,
                inProgress: this.fetchInProgress.size,
                total: this.fetchStats.fetched + this.fetchStats.failed,
                ...this.fetchStats,
                successRate: this.fetchStats.fetched + this.fetchStats.failed > 0 ? ((this.fetchStats.fetched / (this.fetchStats.fetched + this.fetchStats.failed)) * 100).toFixed(1) + '%' : undefined,
            },
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

    _log(...args) {
        this.options.logger('flights-hexcode-mappings:', ...args);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = FlightHexcodeMappings;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
