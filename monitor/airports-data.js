// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = require('./tools-geometry.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Airport ATZ (Aerodrome Traffic Zone) Configuration
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const ATZ_CONFIGURATIONS = {
    GB: {
        name: 'United Kingdom',
        standard: {
            height: 2000, // feet above aerodrome level
            radius: {
                default: 2.5, // nm
                reduced: 2, // nm (for shorter runways or no IATA code)
                threshold: 1850, // meters - runway length threshold for reduced radius
            },
        },
        special: {
            heliport: { height: 1500, radius: 0.5 }, // km (not nm)
            balloonport: { height: 1500, radius: 0.5 }, // km
            seaplane_base: { height: 1500, radius: 0.5 }, // km
        },
        notes: 'UK CAP 493 Manual of Air Traffic Services',
    },

    SE: {
        name: 'Sweden',
        standard: {
            height: 2000, // feet (placeholder - needs verification)
            radius: {
                default: 2.5, // nm (placeholder)
                reduced: 2, // nm (placeholder)
                threshold: 1850, // meters (placeholder)
            },
        },
        special: {
            heliport: { height: 1500, radius: 0.5 }, // km
            balloonport: { height: 1500, radius: 0.5 }, // km
            seaplane_base: { height: 1500, radius: 0.5 }, // km
        },
        notes: 'Swedish AIP - needs proper data',
    },

    US: {
        name: 'United States',
        standard: {
            height: 3000, // Class D airspace typically to 2,500 AGL
            radius: {
                default: 4, // nm (Class D typical)
                reduced: 4, // nm (no reduction)
                threshold: 0, // not used
            },
        },
        special: {
            heliport: { height: 1200, radius: 0.5 }, // km
            balloonport: { height: 1200, radius: 0.5 }, // km
            seaplane_base: { height: 1200, radius: 0.5 }, // km
        },
        notes: 'FAA Class D airspace',
    },

    // Add more countries as needed
    DEFAULT: {
        name: 'ICAO Standard',
        standard: {
            height: 2000,
            radius: {
                default: 2.5,
                reduced: 2,
                threshold: 1800,
            },
        },
        special: {
            heliport: { height: 1500, radius: 0.5 },
            balloonport: { height: 1500, radius: 0.5 },
            seaplane_base: { height: 1500, radius: 0.5 },
        },
        notes: 'ICAO Annex 11 defaults',
    },
};

const AIRPORT_ATZ_RADIUS_MAXIMUM = tools.nmToKm(ATZ_CONFIGURATIONS.DEFAULT.standard.radius.default).value;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function icaoToCountryCode(icao) {
    if (!icao || icao.length < 2) return 'DEFAULT';
    const prefix = icao.slice(0, 2);
    const countryMap = {
        EG: 'GB', // UK
        EI: 'IE', // Ireland
        ES: 'SE', // Sweden
        K: 'US', // USA (single letter)
        LF: 'FR', // France
        ED: 'DE', // Germany
        // ... add more as needed
    };
    // Handle single letter prefixes (like K for USA)
    return countryMap[icao.slice(0, 1)] || countryMap[prefix] || 'DEFAULT';
}

function isSpecialAirportType(airport) {
    return ['heliport', 'balloonport', 'seaplane_base'].includes(airport.type);
}

function atz_getConfig(airport) {
    return ATZ_CONFIGURATIONS[icaoToCountryCode(airport.icao_code)] || ATZ_CONFIGURATIONS.DEFAULT;
}

function atz_getRadius(airport) {
    const config = atz_getConfig(airport);
    // Check for special types first
    if (isSpecialAirportType(airport)) return config.special[airport.type]?.radius || 0.5;
    // Standard airports
    const runwayLengthMax = airport.runwayLengthMax || airport.runways?.reduce((max, runway) => Math.max(runway.length_ft ? runway.length_ft * 0.3048 : 0, max), 0) || 0;
    const useReducedRadius = (runwayLengthMax > 0 && runwayLengthMax < config.standard.radius.threshold) || airport.iata_code?.trim() === '';
    const radiusNm = useReducedRadius ? config.standard.radius.reduced : config.standard.radius.default;
    return tools.nmToKm(radiusNm).value;
}

function atz_getAltitude(airport) {
    const config = atz_getConfig(airport);
    const atzHeight = isSpecialAirportType(airport) ? config.special[airport.type]?.height || 1500 : config.standard.height;
    return (airport.elevation_ft || 0) + atzHeight;
}

// eslint-disable-next-line no-unused-vars
function atz_getInfo(airport) {
    const config = atz_getConfig(airport);
    const radius = atz_getRadius(airport),
        altitude = atz_getAltitude(airport);
    return {
        airport: airport.icao_code,
        country: icaoToCountryCode(airport.icao_code),
        config: config.name,
        radius: {
            km: radius,
            nm: tools.kmToNm(radius).value,
        },
        altitude: {
            feet: altitude,
            meters: tools.feetToMeters(altitude).value,
        },
        type: airport.type || 'standard',
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// AirportsData Base Class
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AirportsData {
    constructor(options) {
        this.options = {
            source: options.source || 'airports-data.js',
            debug: options.debug || false,
            logger: options.logger || console.error, // Default to console.error
        };

        this.source = this.options.source;
        this.data = {};
        this.stats = {
            total: 0,
            valid: 0,
            invalid: 0,
            filtered: 0,
            overridden: 0,
            types: {},
        };

        this._load();
        if (this.options.overrides) {
            this._applyOverrides(this.options.overrides);
        }
        this._validateData();
    }

    length() {
        return this.stats.valid;
    }

    getByICAO(icao) {
        return this.data[icao] || undefined;
    }

    getByIATA(iata) {
        return Object.values(this.data).find((airport) => airport.iata_code && airport.iata_code.toUpperCase() === iata.toUpperCase());
    }

    getAll() {
        return { ...this.data };
    }

    findNearby(_lat, _lon, _options = {}) {
        throw new Error('findNearby must be implemented by subclass');
    }

    _load() {
        try {
            const rawData = require(this.source);
            this.stats.total = Object.keys(rawData).length;

            // Filter and normalize
            Object.entries(rawData).forEach(([icao_code, airport]) => {
                if (this._shouldFilterAirport(airport)) {
                    this.stats.filtered++;
                    return;
                }

                // Ensure icao_code is set
                if (!airport.icao_code) {
                    airport.icao_code = icao_code;
                }

                // Normalize coordinates if needed
                this._normalizeAirportData(airport);

                this.data[icao_code] = airport;

                // Track types
                const type = airport.type || 'unknown';
                this.stats.types[type] = (this.stats.types[type] || 0) + 1;
            });
        } catch (e) {
            throw new Error(`failed to load airports data from ${this.source}: ${e.message}`);
        }
    }

    _shouldFilterAirport(airport) {
        // Extensible filtering
        const filters = [
            // Default filters
            (apt) => apt.type === 'closed',
            // Custom filters from options
            ...(this.options.filters || []),
        ];

        return filters.some((filter) => filter(airport));
    }

    _normalizeAirportData(airport) {
        // Ensure consistent property names
        if (airport.lat !== undefined && airport.latitude_deg === undefined) {
            airport.latitude_deg = airport.lat;
        }
        if (airport.lon !== undefined && airport.longitude_deg === undefined) {
            airport.longitude_deg = airport.lon;
        }
        if (airport.latitude_deg !== undefined && airport.lat === undefined) {
            airport.lat = airport.latitude_deg;
        }
        if (airport.longitude_deg !== undefined && airport.lon === undefined) {
            airport.lon = airport.longitude_deg;
        }
    }

    _applyOverrides(overrides) {
        Object.entries(overrides).forEach(([icao_code, override]) => {
            const existing = this.data[icao_code];

            if (existing) {
                // Override existing
                Object.assign(existing, override);
                this._normalizeAirportData(existing);
            } else {
                // New airport
                this.data[icao_code] = { icao_code, ...override };
                this._normalizeAirportData(this.data[icao_code]);
            }

            this.stats.overridden++;

            if (this.options.logOverrides) {
                this._log(`override applied for ${icao_code}:`, this.data[icao_code]);
            }
        });
    }

    _validateData() {
        let invalidCount = 0;

        Object.entries(this.data).forEach(([icao_code, airport]) => {
            const validation = this._validateAirport(airport);
            if (!validation.valid) {
                invalidCount++;
                if (this.options.logValidation) {
                    this._log(`invalid airport ${icao_code}:`, validation.errors);
                }
                if (this.options.removeInvalid) {
                    delete this.data[icao_code];
                }
            }
        });

        this.stats.invalid = invalidCount;
        this.stats.valid = Object.keys(this.data).length;
    }

    _validateAirport(airport) {
        const errors = [];

        // Required fields
        if (!airport.icao_code) errors.push('Missing icao_code');
        if (typeof airport.latitude_deg !== 'number' || airport.latitude_deg < -90 || airport.latitude_deg > 90) {
            errors.push('invalid latitude_deg');
        }
        if (typeof airport.longitude_deg !== 'number' || airport.longitude_deg < -180 || airport.longitude_deg > 180) {
            errors.push('invalid longitude_deg');
        }

        // Optional but should be valid if present
        if (airport.elevation_ft !== undefined && typeof airport.elevation_ft !== 'number') {
            errors.push('invalid elevation_ft');
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    isSpecialType(airport) {
        return ['heliport', 'balloonport', 'seaplane_base'].includes(airport.type);
    }

    isHeliport(airport) {
        return airport.type === 'heliport';
    }

    getAirportsByType(type) {
        return Object.values(this.data).filter((airport) => airport.type === type);
    }

    getTypeCounts() {
        return { ...this.stats.types };
    }

    //

    getInfo() {
        const typesList = Object.entries(this.stats.types)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([type, count]) => `${type}:${count}`)
            .join(', ');
        return `${this.stats.valid} loaded (${this.spatialIndex ? 'spatial' : 'linear'}), types: ${typesList}`;
    }

    getStats() {
        return { ...this.stats };
    }

    _log(...args) {
        this.options.logger('airports:', ...args);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Linear Search Implementation
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AirportsDataLinearSearch extends AirportsData {
    findNearby(lat, lon, options = {}) {
        // Validate inputs
        const coordValidation = tools.validateCoordinates(lat, lon);
        if (!coordValidation.valid) {
            throw new Error(`invalid coordinates: ${coordValidation.error}`);
        }

        const results = Object.values(this.data)
            .filter(
                (airport) =>
                    // Must have valid coordinates
                    typeof airport.latitude_deg === 'number' && typeof airport.longitude_deg === 'number'
            )
            .map((airport) => {
                const distResult = tools.calculateDistance(lat, lon, airport.latitude_deg, airport.longitude_deg);

                return {
                    ...airport,
                    distance: distResult.distance,
                    distanceNm: distResult.nm,
                };
            })
            .filter((airport) => {
                // Apply filters
                if (options.distance !== undefined) {
                    return airport.distance <= options.distance;
                }

                // Default: within ATZ
                const atzRadius = atz_getRadius(airport);
                if (airport.distance > atzRadius) return false;

                if (options.altitude !== undefined) {
                    const atzAltitude = atz_getAltitude(airport);
                    if (atzAltitude < options.altitude) return false;
                }

                return true;
            })
            .sort((a, b) => a.distance - b.distance);

        // Apply limit if specified
        if (options.limit && results.length > options.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Improved Spatial Indexing Implementation
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AirportsDataSpatialIndexing extends AirportsData {
    constructor(options) {
        super(options);

        // Configuration
        this.gridSize = options.gridSize || 0.5; // degrees
        this.cacheLimit = options.cacheLimit || 1000;
        this.cacheTrimSize = options.cacheTrimSize || 100;

        // Initialize spatial index and cache
        this.spatialIndex = new Map();
        this.cache = new Map();
        this.cacheOrder = [];
        this.cacheHits = 0;
        this.cacheMisses = 0;

        this._buildSpatialIndex();
    }

    _buildSpatialIndex() {
        let maxCellSize = 0;

        Object.values(this.data).forEach((airport) => {
            if (typeof airport.latitude_deg !== 'number' || typeof airport.longitude_deg !== 'number') {
                return;
            }

            const gridKey = this._getGridKey(airport.latitude_deg, airport.longitude_deg);

            if (!this.spatialIndex.has(gridKey)) {
                this.spatialIndex.set(gridKey, []);
            }

            const cell = this.spatialIndex.get(gridKey);
            cell.push(airport);
            maxCellSize = Math.max(maxCellSize, cell.length);
        });

        const avgCellSize = this.stats.valid / this.spatialIndex.size;

        this._log(`spatial index built: ${this.spatialIndex.size} cells, avg=${avgCellSize.toFixed(1)} airports/cell, max=${maxCellSize}`);
    }

    _getGridKey(lat, lon) {
        const latCell = Math.floor(lat / this.gridSize);
        const lonCell = Math.floor(lon / this.gridSize);
        return `${latCell},${lonCell}`;
    }

    _getAdjacentCells(lat, lon, radiusKm) {
        const cells = new Set();

        // Calculate cell range based on radius
        const latDegreesPerKm = 1 / 111.32;
        const lonDegreesPerKm = 1 / (111.32 * Math.cos(tools.deg2rad(lat).value));

        const latCells = Math.ceil((radiusKm * latDegreesPerKm) / this.gridSize);
        const lonCells = Math.ceil((radiusKm * lonDegreesPerKm) / this.gridSize);

        const centerLatCell = Math.floor(lat / this.gridSize);
        const centerLonCell = Math.floor(lon / this.gridSize);

        for (let dlat = -latCells; dlat <= latCells; dlat++) {
            for (let dlon = -lonCells; dlon <= lonCells; dlon++) {
                cells.add(`${centerLatCell + dlat},${centerLonCell + dlon}`);
            }
        }

        return cells;
    }

    findNearby(lat, lon, options = {}) {
        // Validate inputs
        const coordValidation = tools.validateCoordinates(lat, lon);
        if (!coordValidation.valid) {
            throw new Error(`invalid coordinates: ${coordValidation.error}`);
        }

        // Check cache
        const cacheKey = this._getCacheKey(lat, lon, options);
        const cached = this._getFromCache(cacheKey);
        if (cached) {
            this.cacheHits++;
            return cached;
        }

        this.cacheMisses++;

        // Determine search radius
        const searchRadius = options.distance || AIRPORT_ATZ_RADIUS_MAXIMUM;

        // Get airports from relevant grid cells
        const cells = this._getAdjacentCells(lat, lon, searchRadius);
        const candidates = new Map(); // Use Map to deduplicate

        cells.forEach((cellKey) => {
            const cellAirports = this.spatialIndex.get(cellKey) || [];
            cellAirports.forEach((airport) => {
                candidates.set(airport.icao_code, airport);
            });
        });

        // Calculate distances and filter
        const results = [...candidates.values()]
            .map((airport) => {
                const distResult = tools.calculateDistance(lat, lon, airport.latitude_deg, airport.longitude_deg);

                return {
                    ...airport,
                    distance: distResult.distance,
                    distanceNm: distResult.nm,
                };
            })
            .filter((airport) => {
                // Apply filters
                if (options.distance !== undefined) {
                    return airport.distance <= options.distance;
                }

                // Default: within ATZ
                const atzRadius = atz_getRadius(airport);
                if (airport.distance > atzRadius) return false;

                if (options.altitude !== undefined) {
                    const atzAltitude = atz_getAltitude(airport);
                    if (atzAltitude < options.altitude) return false;
                }

                return true;
            })
            .sort((a, b) => a.distance - b.distance);

        // Apply limit if specified
        const finalResults = options.limit && results.length > options.limit ? results.slice(0, options.limit) : results;

        // Cache results
        this._addToCache(cacheKey, finalResults);

        return finalResults;
    }

    _getCacheKey(lat, lon, options) {
        // Round coordinates to reduce cache misses from tiny variations
        const latKey = lat.toFixed(6);
        const lonKey = lon.toFixed(6);
        const optKey = JSON.stringify(options);
        return `${latKey},${lonKey},${optKey}`;
    }

    _getFromCache(key) {
        if (!this.cache.has(key)) return undefined;

        // Move to end of order (LRU)
        const index = this.cacheOrder.indexOf(key);
        if (index !== -1) {
            this.cacheOrder.splice(index, 1);
        }
        this.cacheOrder.push(key);

        return this.cache.get(key);
    }

    _addToCache(key, value) {
        this.cache.set(key, value);
        this.cacheOrder.push(key);

        // Trim cache if needed
        if (this.cache.size > this.cacheLimit) {
            const keysToRemove = this.cacheOrder.splice(0, this.cacheTrimSize);
            keysToRemove.forEach((k) => this.cache.delete(k));
        }
    }

    // Override parent to clear caches
    _applyOverrides(overrides) {
        super._applyOverrides(overrides);
        this._clearCache();
        this._buildSpatialIndex();
    }

    _clearCache() {
        this.cache.clear();
        this.cacheOrder = [];
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    //

    getInfo() {
        const baseInfo = super.getInfo();
        const avgCellSize = this.stats.valid / this.spatialIndex.size;
        const maxCellSize = Math.max(...[...this.spatialIndex.values()].map((cell) => cell.length));
        const spatialInfo = `${this.spatialIndex.size} cells (avg=${avgCellSize.toFixed(1)}, max=${maxCellSize})`;

        // Replace "spatial" with the detailed spatial info
        return `${baseInfo}, spatial: ${spatialInfo}`;
    }

    getStats() {
        return {
            ...this.stats,
            cache: {
                size: this.cache.size,
                hits: this.cacheHits,
                misses: this.cacheMisses,
                hitRate: this.cacheHits + this.cacheMisses > 0 ? ((this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100).toFixed(1) + '%' : 'N/A',
            },
        };
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = function (options) {
    const AirportsDataClass = options?.spatial_indexing ? AirportsDataSpatialIndexing : AirportsDataLinearSearch;
    return new AirportsDataClass(options);
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
