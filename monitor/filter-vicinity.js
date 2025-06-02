// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectVicinity(conf, aircraft) {
    if (aircraft.calculated?.distance === undefined) return undefined;
    if (aircraft.calculated.distance > conf.distance) return undefined;
    if (aircraft.calculated?.altitude !== undefined && aircraft.calculated?.altitude > conf.altitude) return undefined;
    return { isProximate: true };
}

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
        const vicinity = detectVicinity(this.conf, aircraft);
        if (vicinity) aircraft.calculated.vicinity = vicinity;
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
    debug: (type, _aircraft) => {
        if (type == 'sorting') return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
