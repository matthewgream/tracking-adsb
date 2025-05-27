// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateOverheadIntersect(lat, lon, alt, aircraft) {
    if (!aircraft.lat || !aircraft.lon || !aircraft.track || !aircraft.gs || !aircraft.calculated.altitude) return undefined;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || Math.abs(aircraft.lat) > 90 || Math.abs(aircraft.lon) > 180) return undefined;
    if (aircraft.gs <= 0 || aircraft.gs > 2000) return undefined;
    const earthRadius = 6371;
    const stationLatRad = helpers.deg2rad(lat),
        stationLonRad = helpers.deg2rad(lon);
    const aircraftLatRad = helpers.deg2rad(aircraft.lat),
        aircraftLonRad = helpers.deg2rad(aircraft.lon);
    const trackRad = helpers.track2rad(aircraft.track);
    const speed = (aircraft.gs * 1.852) / 60; // Convert knots to km/min
    const cosValue =
        Math.sin(aircraftLatRad) * Math.sin(stationLatRad) + Math.cos(aircraftLatRad) * Math.cos(stationLatRad) * Math.cos(aircraftLonRad - stationLonRad);
    const clampedCosValue = Math.max(-1, Math.min(1, cosValue)); // Clamp to [-1, 1]
    const initialDistance = earthRadius * Math.acos(clampedCosValue);
    const y = Math.sin(stationLonRad - aircraftLonRad) * Math.cos(stationLatRad),
        x = Math.cos(aircraftLatRad) * Math.sin(stationLatRad) - Math.sin(aircraftLatRad) * Math.cos(stationLatRad) * Math.cos(stationLonRad - aircraftLonRad);
    const angleDiff = trackRad - Math.atan2(y, x);
    const sinValue = Math.sin(initialDistance / earthRadius) * Math.sin(angleDiff);
    const clampedSinValue = Math.max(-1, Math.min(1, sinValue)); // Clamp to [-1, 1]
    const crossTrackDistance = Math.asin(clampedSinValue) * earthRadius;
    const cosValue2 = Math.cos(initialDistance / earthRadius) / Math.cos(crossTrackDistance / earthRadius);
    const clampedCosValue2 = Math.max(-1, Math.min(1, cosValue2)); // Clamp to [-1, 1]
    const alongTrackDistance = Math.acos(clampedCosValue2) * earthRadius;
    //
    const overheadFuture = Math.cos(angleDiff) >= 0;
    const overheadDistance = Math.abs(crossTrackDistance);
    const overheadSeconds = Math.round((alongTrackDistance / speed) * 60);
    const overheadTime = new Date(Date.now() + (overheadFuture ? overheadSeconds : -overheadSeconds) * 1000);
    const approachBearing = (aircraft.track + 90) % 360;
    const stationAltitude = alt * 3.28084; // Convert meters to feet
    const overheadAltitude =
        aircraft.baro_rate && overheadFuture
            ? Math.max(0, Math.round(aircraft.calculated.altitude + (aircraft.baro_rate / 60) * overheadSeconds))
            : aircraft.calculated.altitude;
    const relativeAltitude = overheadAltitude - stationAltitude;
    const slantRange = calculateSlantRange(overheadDistance, relativeAltitude);
    const verticalAngle = calculateVerticalAngle(overheadDistance, relativeAltitude, lat);
    return {
        willIntersectOverhead: true,
        overheadFuture,
        overheadDistance,
        overheadSeconds,
        overheadTime,
        overheadAltitude, // Absolute altitude (feet MSL)
        relativeAltitude, // Altitude above observer (feet AGL)
        stationAltitude, // Observer altitude (feet MSL)
        slantRange, // Actual distance to aircraft at overhead point (km)
        verticalRate: aircraft.baro_rate, // feet per minute (can be positive, negative, or null)
        approachBearing,
        approachCardinal: helpers.bearing2Cardinal(approachBearing),
        verticalAngle, // Angle to look up in the sky (degrees)
    };
}

function calculateSlantRange(horizontalDistance, relativeAltitude) {
    const altitudeKm = relativeAltitude * 0.0003048; // feet to km
    return Math.hypot(horizontalDistance * horizontalDistance + altitudeKm * altitudeKm);
}

function calculateVerticalAngle(horizontalDistance, relativeAltitude, observerLat) {
    const altitudeKm = relativeAltitude * 0.0003048; // feet to km
    if (horizontalDistance < 0.001) return relativeAltitude > 0 ? 90 : -90; // Directly overhead or below
    let angle = Math.atan2(altitudeKm, horizontalDistance) * (180 / Math.PI);
    if (horizontalDistance > 10) {
        // Only apply for distances > 10km
        const latRad = Math.abs((observerLat * Math.PI) / 180);
        const curveCorrection = (horizontalDistance * horizontalDistance) / (12800 * Math.cos(latRad));
        angle += Math.atan2(curveCorrection, horizontalDistance) * (180 / Math.PI);
    }
    return Math.max(-90, Math.min(90, angle));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'overhead',
    name: 'Aircraft overhead detection',
    enabled: true,
    priority: 3,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.overhead = { willIntersectOverhead: false };
        const overhead = calculateOverheadIntersect(this.extra.data.location.lat, this.extra.data.location.lon, this.extra.data.location.alt || 0, aircraft);
        if (
            overhead &&
            overhead.willIntersectOverhead &&
            Math.abs(overhead.overheadDistance) < this.conf.radius &&
            Math.abs(overhead.overheadSeconds) < this.conf.time &&
            overhead.overheadAltitude < this.conf.altitude &&
            aircraft.calculated.distance < this.conf.distance
        )
            aircraft.calculated.overhead = overhead;
    },
    evaluate: (aircraft) => aircraft.calculated.overhead.willIntersectOverhead,
    sort: (a, b) => (a.calculated.overhead.overheadTime || Infinity) - (b.calculated.overhead.overheadTime || Infinity),
    getStats: (aircrafts) =>
        this.extra.format.getStats_List(
            'aircraft-overhead',
            aircrafts.filter((a) => a.calculated.overhead.willIntersectOverhead)
        ),
    format: (aircraft) => {
        const { overhead } = aircraft.calculated;
        const { overheadFuture, overheadTime, overheadAltitude, overheadSeconds, approachBearing, approachCardinal, verticalRate, verticalAngle } = overhead;
        let verticalInfo = '';
        if (verticalRate > 0) verticalInfo = ` climbing at ${verticalRate} ft/min`;
        else if (verticalRate < 0) verticalInfo = ` descending at ${Math.abs(verticalRate)} ft/min`;
        const overheadTimePhrase = this.extra.format.formatTimePhrase(overheadSeconds, overheadFuture);
        const altitudeAtOverhead = this.extra.format.formatAltitude(overheadAltitude);
        const verticalAngleDescription = this.extra.format.formatVerticalAngle(verticalAngle);
        const observationGuide = overheadFuture
            ? `${overheadTimePhrase} at ${altitudeAtOverhead}, look ${approachCardinal} ${verticalAngleDescription}`
            : `passed ${overheadTimePhrase} at ${altitudeAtOverhead}`;
        return {
            text: `overhead${verticalInfo}, ${observationGuide}`,
            warn: overheadFuture,
            overheadInfo: {
                approachDirection: {
                    bearing: approachBearing,
                    cardinal: approachCardinal,
                },
                overheadTime,
                overheadFuture,
                overheadSeconds,
                overheadAltitude,
                verticalAngle,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
