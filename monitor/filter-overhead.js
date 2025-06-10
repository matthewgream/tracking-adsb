// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

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
    const overhead = helpers.calculateOverheadTrajectory(lat, lon, alt || 0, aircraft, trajectoryData);
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
