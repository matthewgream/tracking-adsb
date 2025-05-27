// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

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
        const { lat, lon, alt } = this.extra.data.location;
        const overhead = helpers.calculateOverheadTrajectory(lat, lon, alt || 0, aircraft);
        if (overhead?.willIntersectOverhead) {
            if (
                Math.abs(overhead.overheadDistance) < this.conf.radius &&
                Math.abs(overhead.overheadSeconds) < this.conf.time &&
                overhead.overheadAltitude < this.conf.altitude &&
                aircraft.calculated?.distance < this.conf.distance
            )
                aircraft.calculated.overhead = overhead;
        }
    },
    evaluate: (aircraft) => aircraft.calculated.overhead.willIntersectOverhead,
    sort: (a, b) => {
        a = a.calculated.overhead;
        b = b.calculated.overhead;
        return (a.overheadTime || Infinity) - (b.overheadTime || Infinity);
    },
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
