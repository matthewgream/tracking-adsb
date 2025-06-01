// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

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
        aircraft.calculated.emergency = { hasEmergency: false };
        if (aircraft.emergency && aircraft.emergency !== 'none') aircraft.calculated.emergency.hasEmergency = true;
        if (aircraft.squawk && this.emergencySquawks.includes(aircraft.squawk)) aircraft.calculated.emergency.hasEmergency = true;
    },
    evaluate: (aircraft) => aircraft.calculated.emergency.hasEmergency,
    sort: (_a, _b) => 0,
    format: (aircraft) => ({
        text: `EMERGENCY ${aircraft.emergency || aircraft.squawk}`,
        warn: true,
    }),
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
