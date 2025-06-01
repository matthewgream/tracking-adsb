// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'vicinity',
    name: 'Aircraft vicinity detection',
    priority: 4,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.vicinity = { isProximate: false };
        if (aircraft.calculated?.distance <= this.conf.distance && aircraft.calculated?.altitude <= this.conf.altitude)
            aircraft.calculated.vicinity.isProximate = true;
    },
    evaluate: (aircraft) => aircraft.calculated.vicinity.isProximate,
    sort: (_a, _b) => 0,
    format: (aircraft) => {
        const { positionRelative } = aircraft.calculated;
        const direction = positionRelative ? `${positionRelative.cardinalBearing} direction` : 'nearby';
        const trackInfo = aircraft.track ? ` tracking ${helpers.bearing2Cardinal(aircraft.track)}` : '';
        return {
            text: `nearby, look ${direction}${trackInfo}`,
            warn: true,
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
