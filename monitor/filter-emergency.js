// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'emergency',
    name: 'Aircraft in emergency',
    enabled: true,
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
    evaluate: (aircraft) => {
        return aircraft.calculated.is_emergency;
    },
    sort: (a, b) => a.calculated.distance - b.calculated.distance,
    getStats: (aircrafts) =>
        this.extra.format.getStats_List(
            'aircraft-emergency',
            aircrafts.filter((a) => a.calculated.is_emergency)
        ),
    format: (aircraft) => {
        return {
            text: `EMERGENCY ${aircraft.emergency || aircraft.squawk}`,
            warn: true,
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
