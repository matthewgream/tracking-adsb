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
            this.mappings = new FlightHexcodeMappings(options.mappings || {});
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
            const { replaced, updated } = this.mappings.processAircraft(data.aircraft);
            if (this.options.debug && (replaced > 0 || updated > 0)) {
                this._log(`mappings: replaced=${replaced}, updated=${updated}`);
            }
        }

        // Add metadata
        data._metadata = {
            timestamp: Date.now(),
            aircraftCount: data.aircraft?.length || 0,
        };

        return data;
    }

    // Utility methods
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.requests > 0 ? ((this.stats.successful / this.stats.requests) * 100).toFixed(1) + '%' : 'N/A',
            mappingStats: this.mappings ? this.mappings.getStats() : undefined,
        };
    }

    getMappings() {
        return this.mappings;
    }

    destroy() {
        if (this.mappings) {
            this.mappings.destroy();
        }
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
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
