// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');
const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateOverheadDetails(lat, lon, alt, aircraft, trajectoryData = undefined) {
    // ===== 1. Input validation and screening =====

    const observerCheck = tools.validateCoordinates(lat, lon).valid;
    if (!observerCheck.valid) return { error: `Observer ${observerCheck.error}` };
    const altCheck = tools.validateNumber(alt, -1000, 10000, 'observer altitude (meters)').valid;
    if (!altCheck.valid) return { error: altCheck.error };
    const required = {
        lat: aircraft.lat,
        lon: aircraft.lon,
        track: aircraft.track,
        gs: aircraft.gs,
        altitude: aircraft.calculated?.altitude,
    };
    for (const [key, value] of Object.entries(required)) if (value === undefined || value === null) return { error: `Missing required field: ${key}` };
    const aircraftCheck = tools.validateCoordinates(aircraft.lat, aircraft.lon).valid;
    if (!aircraftCheck.valid) return { error: `Aircraft ${aircraftCheck.error}` };
    const validations = [tools.validateNumber(aircraft.track, 0, 360, 'track').valid, tools.validateNumber(aircraft.gs, 0, 2000, 'ground speed').valid, tools.validateNumber(aircraft.calculated.altitude, 0, 60000, 'altitude').valid];
    for (const check of validations) if (!check.valid) return { error: check.error };

    // ===== 2. Core calculations =====

    const stationAltitudeFeet = alt * 3.28084;
    const speedKmMin = tools.knotsToKmPerMin(aircraft.gs).value;
    const crossTrackResult = calculateCrossTrackDistance(lat, lon, aircraft.lat, aircraft.lon, aircraft.track);
    if (crossTrackResult.error) return { error: crossTrackResult.error };
    const { crossTrackDistance, alongTrackDistance, isApproaching } = crossTrackResult;
    const overheadDistance = Math.abs(crossTrackDistance);
    const overheadSeconds = Math.round(Math.abs(alongTrackDistance / speedKmMin) * 60);
    const overheadTime = new Date(Date.now() + (isApproaching ? overheadSeconds : -overheadSeconds) * 1000);
    const approachBearing = tools.normalizeDegrees(aircraft.track + (crossTrackDistance >= 0 ? 90 : -90));
    const overheadAltitude = aircraft.baro_rate && isApproaching ? aircraft.calculated.altitude : Math.max(0, Math.round(aircraft.calculated.altitude + (aircraft.baro_rate / 60) * overheadSeconds));
    const relativeAltitude = overheadAltitude - stationAltitudeFeet;
    const slantRange = tools.calculateSlantRange(overheadDistance, relativeAltitude).range;
    const verticalAngle = tools.calculateVerticalAngle(overheadDistance, relativeAltitude, lat).angle;

    // ===== 3. Prepare return data =====

    const result = {
        willIntersectOverhead: true,
        overheadFuture: isApproaching,
        overheadDistance: Number(overheadDistance.toFixed(3)),
        overheadSeconds,
        overheadTime,
        overheadAltitude,
        relativeAltitude,
        stationAltitude: stationAltitudeFeet,
        slantRange: Number(slantRange.toFixed(3)),
        verticalRate: aircraft.baro_rate || undefined,
        approachBearing: Number(approachBearing.toFixed(1)),
        approachCardinal: tools.bearingToCardinal(approachBearing).cardinal,
        verticalAngle: Number(verticalAngle.toFixed(1)),
        crossTrackDistance: Number(crossTrackDistance.toFixed(3)),
        alongTrackDistance: Number(alongTrackDistance.toFixed(3)),
        currentDistance: tools.calculateDistance(lat, lon, aircraft.lat, aircraft.lon).distance,
    };

    // ===== 4. Multi-point trajectory analysis (future use) =====

    if (trajectoryData?.positions?.length >= 2) {
        const trajectoryAnalysis = analyzeOverheadTrajectory(aircraft, trajectoryData, result, lat, lon);
        result.trajectoryConfidence = trajectoryAnalysis.confidence;
        result.trajectoryAnalysis = trajectoryAnalysis;
    }

    return result;
}

function calculateCrossTrackDistance(obsLat, obsLon, aircraftLat, aircraftLon, aircraftTrack) {
    const gcDistance = tools.calculateDistance(obsLat, obsLon, aircraftLat, aircraftLon).distance;
    if (gcDistance < 0.001) return { crossTrackDistance: 0, alongTrackDistance: 0, isApproaching: false };
    const bearingToObs = tools.calculateBearing(aircraftLat, aircraftLon, obsLat, obsLon).bearing;
    const trackBearingDiff = tools.normalizeDegrees(bearingToObs - aircraftTrack);
    const trackBearingDiffRad = tools.deg2rad(trackBearingDiff).value;
    const crossTrackDistance = gcDistance * Math.sin(trackBearingDiffRad);
    const alongTrackDistance = gcDistance * Math.cos(trackBearingDiffRad);
    const isApproaching = Math.abs(trackBearingDiff) < 90;
    return {
        crossTrackDistance,
        alongTrackDistance: Math.abs(alongTrackDistance),
        isApproaching,
    };
}

function analyzeOverheadTrajectory(aircraft, trajectoryData, overheadResult, stationLat, stationLon) {
    const { positions, tracks = [], altitudes = [] } = trajectoryData;
    if (positions.length < 3) return { confidence: 0.5, reason: 'Insufficient data points' };
    let confidence = 1;
    const factors = {};
    if (tracks.length >= 3) {
        const avgTrack = tracks.reduce((a, b) => a + b, 0) / tracks.length;
        const trackVariance =
            tracks.reduce((sum, t) => {
                const diff = Math.abs(t - avgTrack);
                return sum + (diff > 180 ? 360 - diff : diff) ** 2;
            }, 0) / tracks.length;
        factors.trackStability = trackVariance < 25;
        if (!factors.trackStability) confidence *= 0.7;
    }
    const recentPositions = positions.slice(-5);
    if (recentPositions.length >= 3) {
        const crossTrackDistances = recentPositions.map((pos) => {
            const result = calculateCrossTrackDistance(stationLat, stationLon, pos.lat, pos.lon, aircraft.track);
            return Math.abs(result.crossTrackDistance);
        });
        const minCrossTrack = Math.min(...crossTrackDistances);
        const maxCrossTrack = Math.max(...crossTrackDistances);
        factors.trajectoryConverging = maxCrossTrack - minCrossTrack > 0.5;
        if (!factors.trajectoryConverging && overheadResult.overheadDistance > 2) confidence *= 0.6;
    }
    if (aircraft.baro_rate && altitudes.length >= 3) {
        const recentAltitudes = altitudes.slice(-3);
        const altitudeChanges = [];
        for (let i = 1; i < recentAltitudes.length; i++) altitudeChanges.push(recentAltitudes[i] - recentAltitudes[i - 1]);
        const avgAltChange = altitudeChanges.reduce((a, b) => a + b, 0) / altitudeChanges.length;
        factors.altitudeConsistent = Math.sign(avgAltChange) === Math.sign(aircraft.baro_rate);
        if (!factors.altitudeConsistent) confidence *= 0.8;
    }
    return {
        confidence: Math.max(0, Math.min(1, confidence)),
        factors,
        dataPoints: positions.length,
        trackPoints: tracks.length,
        altitudePoints: altitudes.length,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectOverhead(conf, extra, aircraft, aircraftData) {
    const { lat, lon, alt } = extra.data.location;
    // Pass aircraftData to get trajectory data for the helper
    const trajectoryData = aircraftData
        ? {
              positions: aircraftData.getPositions(),
              tracks: aircraftData.getField('track').values,
              altitudes: aircraftData.getField('calculated.altitude').values,
          }
        : undefined;
    const overhead = calculateOverheadDetails(lat, lon, alt || 0, aircraft, trajectoryData);
    if (!overhead?.willIntersectOverhead) return undefined;
    if (aircraft.calculated?.distance !== undefined && aircraft.calculated.distance > conf.distance) return undefined;
    if (Math.abs(overhead.overheadDistance) > conf.radius || Math.abs(overhead.overheadSeconds) > conf.time || overhead.overheadAltitude > conf.altitude) return undefined;
    return overhead;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'overhead',
    name: 'Aircraft overhead detection',
    priority: 3,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft, { aircraftData }) => {
        aircraft.calculated.overhead = { willIntersectOverhead: false };
        const overhead = detectOverhead(this.conf, this.extra, aircraft, aircraftData);
        if (overhead) aircraft.calculated.overhead = overhead;
    },
    evaluate: (aircraft) => aircraft.calculated.overhead.willIntersectOverhead,
    sort: (a, b) => {
        const a_ = a.calculated.overhead,
            b_ = b.calculated.overhead;
        return a_.overheadTime - b_.overheadTime;
    },
    format: (aircraft) => {
        const { overhead } = aircraft.calculated;
        const { overheadFuture, overheadTime, overheadAltitude, overheadSeconds, approachBearing, approachCardinal, verticalRate, verticalAngle } = overhead;
        let verticalInfo = '';
        if (verticalRate > 0) verticalInfo = ` climbing at ${verticalRate} ft/min`;
        else if (verticalRate < 0) verticalInfo = ` descending at ${Math.abs(verticalRate)} ft/min`;
        const overheadTimePhrase = this.extra.format.formatTimePhrase(overheadSeconds, overheadFuture);
        const altitudeAtOverhead = this.extra.format.formatAltitude(overheadAltitude);
        const verticalAngleDescription = this.extra.format.formatVerticalAngle(verticalAngle);
        const observationGuide = overheadFuture ? `${overheadTimePhrase} at ${altitudeAtOverhead}, look ${approachCardinal} ${verticalAngleDescription}` : `passed ${overheadTimePhrase} at ${altitudeAtOverhead}`;
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
    debug: (type, aircraft) => {
        const { overhead } = aircraft.calculated;
        if (type == 'sorting') return `${overhead.overheadFuture ? 'future' : 'past'}, ${overhead.overheadSeconds}s`;
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
