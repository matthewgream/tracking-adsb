// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1),
        dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const AIRPORT_ATZ_RADIUS_MAXIMUM = 2.5 * 1.852;
function airportATZradius(airport) {
    if (airport.radius) return airport.radius; // km
    if (airport.runwayLengthMax) return (airport.runwayLengthMax < 1850 ? 2 : 2.5) * 1.852;
    return (airport.iata?.trim() === '' ? 2 : 2.5) * 1.852;
}
function airportATZaltitude(airport) {
    return (airport.elevation || 0) + (airport.height || 2000);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AirportsData {
    constructor(options) {
        this.data = require(options.source || 'airports-data.js');
        if (options.apply) this._apply(options.apply);
    }

    length() {
        return Object.keys(this.data).length;
    }

    findNearby() {
        throw new TypeError('Not implemented in Base Class');
    }

    _apply(airports) {
        Object.entries(airports).forEach(([icao, airport]) => {
            if (!this.data[icao]) this.data[icao] = { icao };
            Object.assign(this.data[icao], airport);
            console.error(`airportsData: override [${icao}]: ${JSON.stringify(this.data[icao])}`);
        });
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AirportsDataLinearSearch extends AirportsData {
    findNearby(lat, lon, options = {}) {
        return Object.entries(this.data)
            .filter(([_, airport]) => airport.lat && airport.lon)
            .map(([_, airport]) => ({ ...airport, distance: calculateDistance(lat, lon, airport.lat, airport.lon) }))
            .filter((airport) => {
                if (options.distance) return airport.distance <= options.distance;
                if (airport.distance > airportATZradius(airport)) return false;
                if (options.altitude && airportATZaltitude(airport) < options.altitude) return false;
                return true;
            })
            .sort((a, b) => a.distance - b.distance);
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AirportsDataSpatialIndexing extends AirportsData {
    constructor(options) {
        super(options);
        this.spatialIndex = new Map();
        this.cacheNearby = new Map();
        this.cacheLimit = 1000;
        this.cacheTrim = 100;
        this.cacheOrder = [];
        this.gridSize = 0.5; // 0.5 degree grid cells (~55km at equator)
        this.buildSpatialIndex();
    }

    buildSpatialIndex() {
        Object.entries(this.data).forEach(([icao, airport]) => {
            if (airport.lat === undefined || airport.lon === undefined) return;
            airport.icao = airport.icao || icao;
            const gridKey = this.getGridKey(airport.lat, airport.lon);
            if (!this.spatialIndex.has(gridKey)) this.spatialIndex.set(gridKey, []);
            this.spatialIndex.get(gridKey).push(airport);
        });
        console.error(`airportsData: spatial index built with ${this.spatialIndex.size} grid cells (cache: limit=${this.cacheLimit}, trim=${this.cacheTrim})`);
    }

    getGridKey(lat, lon) {
        return `${Math.floor(lat / this.gridSize)},${Math.floor(lon / this.gridSize)}`;
    }

    getAdjacentCells(lat, lon, radiusKm) {
        const cells = new Set();
        const latRadius = radiusKm / 111.32,
            lonRadius = radiusKm / (111.32 * Math.cos(deg2rad(lat)));
        const latCells = Math.ceil(latRadius / this.gridSize),
            lonCells = Math.ceil(lonRadius / this.gridSize);
        const centerLatCell = Math.floor(lat / this.gridSize),
            centerLonCell = Math.floor(lon / this.gridSize);
        for (let dlat = -latCells; dlat <= latCells; dlat++)
            for (let dlon = -lonCells; dlon <= lonCells; dlon++) cells.add(`${centerLatCell + dlat},${centerLonCell + dlon}`);
        return cells;
    }

    findNearby(lat, lon, options = {}) {
        const cacheKey = `${lat.toFixed(6)},${lon.toFixed(6)},${JSON.stringify(options)}`;
        if (this.cacheNearby.has(cacheKey)) {
            const index = this.cacheOrder.indexOf(cacheKey);
            if (index !== -1) this.cacheOrder.splice(index, 1);
            this.cacheOrder.push(cacheKey);
            return this.cacheNearby.get(cacheKey);
        }
        const candidates = [...this.getAdjacentCells(lat, lon, options.distance || AIRPORT_ATZ_RADIUS_MAXIMUM)].flatMap(
            (gridKey) => this.spatialIndex.get(gridKey) || []
        );
        const results = candidates
            .map((airport) => ({ ...airport, distance: calculateDistance(lat, lon, airport.lat, airport.lon) }))
            .filter((airport) => {
                if (options.distance) return airport.distance <= options.distance;
                if (airport.distance > airportATZradius(airport)) return false;
                if (options.altitude && airportATZaltitude(airport) < options.altitude) return false;
                return true;
            })
            .sort((a, b) => a.distance - b.distance);
        const seen = new Set();
        const uniques = results.filter((airport) => {
            if (seen.has(airport.icao)) return false;
            seen.add(airport.icao);
            return true;
        });
        this.cacheNearby.set(cacheKey, uniques);
        this.cacheOrder.push(cacheKey);
        if (this.cacheNearby.size > this.cacheLimit) this.cacheOrder.splice(0, this.cacheTrim).forEach((key) => this.cacheNearby.delete(key));
        return uniques;
    }

    apply(airports) {
        super._apply(airports);
        this.spatialIndex.clear();
        this.cacheNearby.clear();
        this.cacheOrder = [];
        this.buildSpatialIndex();
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = function (options) {
    return options?.spatial_indexing ? new AirportsDataSpatialIndexing(options) : new AirportsDataLinearSearch(options);
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
