// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateLifingTrajectory(lat, lon, aircraft) {
    if (!aircraft.lat || !aircraft.lon || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude || !aircraft.baro_rate) return undefined;
    if (aircraft.baro_rate < 300) return undefined; // Significant climb rate
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
                if (lifting.hasKnownOrigin) lifting.departureAirport = lifting.nearbyAirports[0];
                aircraft.calculated.lifting = lifting;
            }
        }
    },
    evaluate: (aircraft) => {
        return aircraft.calculated.lifting.isLiftingOff;
    },
    sort: (a, b) => {
        return b.calculated.lifting.liftingScore - a.calculated.lifting.liftingScore;
    },
    getStats: (aircrafts) => {
        const liftingAircraft = aircrafts.filter((a) => a.calculated.lifting.isLiftingOff);
        const byAirport = liftingAircraft
            .filter((a) => a.calculated.lifting.hasKnownOrigin)
            .map((a) => a.calculated.lifting.departureAirport?.name || a.calculated.lifting.departureAirport?.icao)
            .reduce((counts, airport) => ({ ...counts, [airport]: (counts[airport] || 0) + 1 }), {});
        return {
            ...this.extra.format.getStats_List('aircraft-lifting', liftingAircraft),
            knownOriginCount: liftingAircraft.filter((a) => a.calculated.lifting.hasKnownOrigin).length,
            unknownOriginCount: liftingAircraft.filter((a) => !a.calculated.lifting.hasKnownOrigin).length,
            byAirport,
        };
    },
    format: (aircraft) => {
        const airportLifting = aircraft.calculated.lifting.hasKnownOrigin
            ? ` from ${aircraft.calculated.lifting.departureAirport.name || aircraft.calculated.lifting.departureAirport.icao}`
            : '';
        return {
            text: `climbing${airportLifting} at ${aircraft.calculated.lifting.climbRate} ft/min`,
            liftingInfo: {
                departureAirport: aircraft.calculated.lifting.departureAirport,
                departureTime: aircraft.calculated.lifting.departureTime,
                climbRate: aircraft.calculated.lifting.climbRate,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
