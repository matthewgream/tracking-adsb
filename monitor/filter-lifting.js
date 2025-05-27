// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLifingTrajectory(lat, lon, aircraft) {
    if (!aircraft.lat || !aircraft.lon || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude || !aircraft.baro_rate) return undefined;
    const getMinClimbRate = (aircraft) => {
        switch (aircraft.category) {
            case 'A0': // No information
            case 'A1': // Light aircraft (<15.5k lbs)
                return 200; // Light aircraft can take off with lower climb rates
            case 'A2': // Small (15.5-75k lbs)
                return 250;
            case 'A3': // Large (75-300k lbs)
            case 'A4': // High-Vortex Large (B757)
            case 'A5': // Heavy (>300k lbs)
                return 300; // Heavy aircraft need higher climb rates to be significant
            case 'A7': // Rotorcraft
                return 100; // Helicopters can have very low climb rates
            case 'B1': // Glider
                return 150; // Gliders have low climb rates
            case 'B4': // Ultralight
                return 150; // Ultralights climb slowly
            case 'B6': // UAV/Drone
                return 100; // Small drones
            default:
                return 250; // Conservative default
        }
    };
    const minClimbRate = getMinClimbRate(aircraft);
    if (aircraft.baro_rate < minClimbRate) return undefined;
    const climbIndicator = aircraft.calculated.altitude < 3000 ? 2 : 1; // Weight lower altitudes more heavily
    const liftingScore = ((climbIndicator * aircraft.baro_rate) / 100) * (1 - Math.min(1, aircraft.calculated.altitude / 10000));
    if (liftingScore < 3) return undefined; // Adjust threshold as needed
    const ascendRate = aircraft.baro_rate;
    const timeToReachCruise = (30000 - aircraft.calculated.altitude) / ascendRate; // Time to reach 30,000 ft
    const climbMinutes = Math.min(timeToReachCruise, 15) / 60; // Cap at 15 minutes
    const groundSpeedKmMin = (aircraft.gs * 1.852) / 60; // Convert to km/min
    const distanceTraveled = groundSpeedKmMin * climbMinutes; // km
    const trackRad = helpers.track2rad(aircraft.track);
    const dx = distanceTraveled * Math.cos(trackRad);
    const dy = distanceTraveled * Math.sin(trackRad);
    const latPerKm = 1 / 111.32;
    const lonPerKm = 1 / (111.32 * Math.cos(helpers.deg2rad(aircraft.lat))); // Adjusted for latitude
    const projectedLat = aircraft.lat + dy * latPerKm;
    const projectedLon = aircraft.lon + dx * lonPerKm;
    const projectedPosition = helpers.calculateRelativePosition(lat, lon, projectedLat, projectedLon, aircraft.track);
    return {
        isLiftingOff: true,
        departureAltitude: aircraft.calculated.altitude,
        climbRate: aircraft.baro_rate,
        liftingScore,
        projectedLat: Number(projectedLat.toFixed(6)),
        projectedLon: Number(projectedLon.toFixed(6)),
        projectedPosition,
        departureTime: new Date(Date.now() - (aircraft.calculated.altitude / aircraft.baro_rate) * 60 * 1000), // Estimate time of departure
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'lifting',
    name: 'Aircraft lifting detection',
    enabled: true,
    priority: 2, // Same priority as landing
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.lifting = { isLiftingOff: false };
        if (!this.conf.altitude || aircraft.calculated.altitude < this.conf.altitude) {
            const lifting = calculateLifingTrajectory(this.extra.data.location.lat, this.extra.data.location.lon, aircraft);
            if (lifting && lifting.isLiftingOff) {
                lifting.nearbyAirports = this.extra.data.airports.findNearby(aircraft.lat, aircraft.lon, {
                    distance: this.conf.radius,
                });
                lifting.hasKnownOrigin = lifting.nearbyAirports.length > 0;
                if (lifting.hasKnownOrigin) [lifting.departureAirport] = lifting.nearbyAirports;
                aircraft.calculated.lifting = lifting;
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.lifting.isLiftingOff,
    sort: (a, b) => b.calculated.lifting.liftingScore - a.calculated.lifting.liftingScore,
    getStats: (aircrafts) => {
        const list = aircrafts.filter((a) => a.calculated.lifting.isLiftingOff);
        const byAirport = list
            .filter((a) => a.calculated.lifting.hasKnownOrigin)
            .map((a) => a.calculated.lifting.departureAirport?.name || a.calculated.lifting.departureAirport?.icao)
            .reduce((counts, airport) => ({ ...counts, [airport]: (counts[airport] || 0) + 1 }), {});
        return {
            ...this.extra.format.getStats_List('aircraft-lifting', list),
            knownOriginCount: list.filter((a) => a.calculated.lifting.hasKnownOrigin).length,
            unknownOriginCount: list.filter((a) => !a.calculated.lifting.hasKnownOrigin).length,
            byAirport,
        };
    },
    format: (aircraft) => {
        const { lifting } = aircraft.calculated;
        const airportName = this.extra.format.formatAirport(lifting.hasKnownOrigin ? lifting.departureAirport : undefined);
        return {
            text: `climbing${airportName ? ' from ' + airportName : ''} at ${lifting.climbRate} ft/min`,
            liftingInfo: {
                departureAirport: lifting.departureAirport,
                departureTime: lifting.departureTime,
                climbRate: lifting.climbRate,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
