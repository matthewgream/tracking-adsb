// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'emergency',
    name: 'Aircraft in emergency',
    priority: 1,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.emergencySquawks = ['7500', '7600', '7700'];
    },
    preprocess: (aircraft) => {
        aircraft.calculated.is_emergency = false;
        if (aircraft.emergency && aircraft.emergency !== 'none') aircraft.calculated.is_emergency = true;
        if (aircraft.squawk && this.emergencySquawks.includes(aircraft.squawk)) aircraft.calculated.is_emergency = true;
    },
    evaluate: (aircraft) => aircraft.calculated.is_emergency,
    sort: (a, b) => helpers.sortDistance(a, b),
    format: (aircraft) => ({
        text: `EMERGENCY ${aircraft.emergency || aircraft.squawk}`,
        warn: true,
    }),
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
