// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const net = require('net');

class LocationManager {
    constructor(config) {
        this.gpsdConfig = config.gpsd_averaged;
        this.fallbackLocation = {
            lat: config.lat,
            lon: config.lon,
            alt: config.alt,
        };

        this.currentLocation = { ...this.fallbackLocation };

        this.lastSuccessfulFetch = null;
        this.consecutiveFailures = 0;
        this.updateTimer = null;
        this.isDestroyed = false;

        if (this.gpsdConfig?.server) {
            const [host, port] = this.gpsdConfig.server.split(':');
            this.gpsdHost = host;
            this.gpsdPort = parseInt(port) || 2948;
            this.updatePeriod = (this.gpsdConfig.period || 1800) * 1000; // Default 30 minutes

            this.fetchLocation();

            this.updateTimer = setInterval(() => {
                if (!this.isDestroyed) this.fetchLocation();
            }, this.updatePeriod);
        }

        console.error(`location: initialized - gpsd: ${this.gpsdConfig?.server || 'disabled'}, fallback: ${this.fallbackLocation.lat}/${this.fallbackLocation.lon}/${this.fallbackLocation.alt}`);
    }

    getLocation() {
        return { ...this.currentLocation };
    }

    getInfo() {
        const pos = this.getLocation();
        let info = `lat=${pos.lat.toFixed(6)}, lon=${pos.lon.toFixed(6)}, alt=${pos.alt}`;

        if (this.gpsdConfig?.server) {
            info += `, gpsd=${this.gpsdConfig.server}`;
            if (this.lastSuccessfulFetch) info += ` (updated ${Math.floor((Date.now() - this.lastSuccessfulFetch) / 1000)}s ago)`;
            else if (this.consecutiveFailures > 0) info += ` (${this.consecutiveFailures} failures, using fallback)`;
            else info += ` (waiting for first update)`;
        } else info += ' (static config)';

        return info;
    }

    validateLocation(location) {
        if (!location) return false;

        const { lat, lon, alt } = location;
        if (lat == null || lon == null || alt == null) return false;
        if (isNaN(lat) || isNaN(lon) || isNaN(alt)) return false;

        if (lat < -90 || lat > 90) return false;
        if (lon < -180 || lon > 180) return false;
        if (alt < -1000 || alt > 100000) return false; // -1000m to 100km

        return true;
    }

    async fetchLocation() {
        if (!this.gpsdHost || !this.gpsdPort) return;

        return new Promise((resolve) => {
            const client = new net.Socket();
            let dataBuffer = '';
            let timeout;

            const cleanup = () => {
                clearTimeout(timeout);
                client.destroy();
            };

            timeout = setTimeout(() => {
                this.handleFetchError('Timeout');
                cleanup();
                resolve(false);
            }, 5000);

            client.on('connect', () => {
                client.write('?POLL;\n');
            });

            client.on('data', (data) => {
                dataBuffer += data.toString();

                if (dataBuffer.includes('\n') || dataBuffer.includes('}')) {
                    try {
                        const response = JSON.parse(dataBuffer.trim());
                        if (response.lat !== undefined && response.lon !== undefined && response.alt !== undefined) {
                            const newLocation = {
                                lat: parseFloat(response.lat),
                                lon: parseFloat(response.lon),
                                alt: Math.round(response.alt), // Round altitude to nearest meter
                            };
                            if (this.validateLocation(newLocation)) {
                                this.currentLocation = newLocation;
                                this.lastSuccessfulFetch = Date.now();
                                this.consecutiveFailures = 0;
                                console.error(
                                    `location: updated from gpsd - lat=${newLocation.lat.toFixed(6)}, lon=${newLocation.lon.toFixed(6)}, alt=${newLocation.alt}m` +
                                        (response.samples ? `, samples=${response.samples}` : '') +
                                        (response.lat_err && response.lon_err ? `, uncertainty=${response.lat_err}/${response.lon_err}m` : '')
                                );
                            } else this.handleFetchError('invalid location data');
                        } else this.handleFetchError('missing location fields');
                    } catch (e) {
                        this.handleFetchError(`parse error: ${e.message}`);
                    }

                    cleanup();
                    resolve(true);
                }
            });

            client.on('error', (err) => {
                this.handleFetchError(`connection error: ${err.message}`);
                cleanup();
                resolve(false);
            });

            client.on('close', () => {
                cleanup();
                resolve(true);
            });

            try {
                client.connect(this.gpsdPort, this.gpsdHost);
            } catch (err) {
                this.handleFetchError(`connect error: ${err.message}`);
                cleanup();
                resolve(false);
            }
        });
    }

    handleFetchError(error) {
        this.consecutiveFailures++;

        if (this.consecutiveFailures === 1 || this.consecutiveFailures % 10 === 0) console.error(`location: gpsd fetch failed (${this.consecutiveFailures}x) - ${error}`);

        if (!this.lastSuccessfulFetch && this.fallbackLocation.lat !== undefined) {
            if (this.consecutiveFailures === 1) console.error(`location: using fallback location - lat=${this.fallbackLocation.lat}, lon=${this.fallbackLocation.lon}, alt=${this.fallbackLocation.alt}`);
            this.currentLocation = { ...this.fallbackLocation };
        }
    }

    destroy() {
        this.isDestroyed = true;
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = { LocationManager };

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
