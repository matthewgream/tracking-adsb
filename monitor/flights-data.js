// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const http = require('http');
const https = require('https');
const FlightHexcodeMappings = require('./flights-hexcode-mappings.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class FlightDataFetcher {
    constructor(options = {}) {
        this.options = {
            timeout: options.timeout || 15000,
            retries: options.retries || 3,
            retryDelay: options.retryDelay || 1000,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'ADSB-Monitor/1.0',
                ...options.headers,
            },
            validateResponse: options.validateResponse !== false,
            debug: options.debug || false,
            logger: options.logger || console.error, // Default to console.error
        };

        // Optional hex mapping integration
        if (options.mappings !== false) {
            this.mappings = new FlightHexcodeMappings({
                fetchOnline: true,
                fetchMode: 'missing', // or 'all' to fetch all hex codes
                fetchQueueInterval: 2000, // 2 seconds between fetch batches
                fetchBatchSize: 10, // max 10 concurrent requests
                expiryTime: 90 * 24 * 60 * 60 * 1000, // 90 days for local mappings
                onlineExpiryTime: 180 * 24 * 60 * 60 * 1000, // 180 days for online data
                ...options.mappings,
            });
        }

        this.stats = {
            requests: 0,
            successful: 0,
            failed: 0,
            retries: 0,
            lastError: undefined,
            lastSuccess: undefined,
        };
    }

    destroy() {
        if (this.mappings) {
            this.mappings.destroy();
        }
    }

    async fetch(url) {
        this.stats.requests++;

        for (let attempt = 0; attempt <= this.options.retries; attempt++) {
            if (attempt > 0) {
                this.stats.retries++;
                await this._delay(this.options.retryDelay * attempt);
                if (this.options.debug) {
                    this._log(`retry attempt ${attempt} for ${url}`);
                }
            }

            try {
                const data = await this._fetchInternal(url);
                this.stats.successful++;
                this.stats.lastSuccess = new Date();
                return data;
            } catch (e) {
                this.stats.lastError = e;
                if (attempt === this.options.retries) {
                    this.stats.failed++;
                    throw e;
                }
            }
        }

        throw new Error('Unexpected error: retry loop completed without returning');
    }

    async _fetchInternal(url) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: this.options.headers,
                timeout: this.options.timeout,
            };

            const req = protocol.request(options, (res) => {
                const { headers, statusCode, statusMessage } = res;
                const contentType = headers['content-type'];

                // Check status
                if (statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${statusCode}: ${statusMessage}`));
                    return;
                }

                // Check content type
                if (this.options.validateResponse && !contentType?.includes('application/json')) {
                    res.resume();
                    reject(new Error(`Invalid content-type: ${contentType}, expected application/json`));
                    return;
                }

                // Collect data
                res.setEncoding('utf8');
                let rawData = '';

                res.on('data', (chunk) => {
                    rawData += chunk;
                });

                res.on('end', () => {
                    try {
                        const data = JSON.parse(rawData);
                        const processed = this._processResponse(data);
                        resolve(processed);
                    } catch (e) {
                        reject(new Error(`JSON parse error: ${e.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Network error: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${this.options.timeout}ms`));
            });

            req.end();
        });
    }

    _processResponse(data) {
        // Validate structure
        if (this.options.validateResponse) {
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid response: not an object');
            }
            if (!Array.isArray(data.aircraft)) {
                throw new TypeError('Invalid response: missing or invalid aircraft array');
            }
        }

        // Process with mappings if available
        if (this.mappings && data.aircraft) {
            const { replaced, updated, queued } = this.mappings.processAircraft(data.aircraft);
            if (this.options.debug && (replaced > 0 || updated > 0 || queued > 0)) {
                this._log(`mappings: replaced=${replaced}, updated=${updated}, queued=${queued}`);
            }
        }

        // Add metadata
        data._metadata = {
            timestamp: Date.now(),
            aircraftCount: data.aircraft?.length || 0,
        };

        return data;
    }

    getMappings() {
        return this.mappings;
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    //

    getInfo() {
        const mappingInfo = this.mappings ? `, mappings=enabled` : ', mappings=disabled';
        return `timeout=${this.options.timeout}ms, retries=${this.options.retries}${mappingInfo}`;
    }

    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.requests > 0 ? ((this.stats.successful / this.stats.requests) * 100).toFixed(1) + '%' : 'N/A',
            mappingStats: this.mappings ? this.mappings.getStats() : undefined,
        };
    }

    _log(...args) {
        this.options.logger('flights-data:', ...args);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports.FlightDataFetcher = FlightDataFetcher;
module.exports.FlightHexcodeMappings = FlightHexcodeMappings;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
