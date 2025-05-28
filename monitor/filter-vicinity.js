// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'vicinity',
    name: 'Aircraft vicinity detection',
    enabled: true,
    priority: 4,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
    },
    preprocess: (aircraft) => {
        aircraft.calculated.is_proximate = false;
        if (aircraft.calculated?.distance <= this.conf.distance && aircraft.calculated?.altitude <= this.conf.altitude) aircraft.calculated.is_proximate = true;
    },
    evaluate: (aircraft) => aircraft.calculated.is_proximate,
    sort: (a, b) => a.calculated.distance - b.calculated.distance,
    getStats: (aircrafts) =>
        this.extra.format.formatStatsList(
            'aircraft-vicinity',
            aircrafts.filter((a) => a.calculated.is_proximate)
        ),
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
