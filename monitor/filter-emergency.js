// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectEmergency(conf, aircraft) {
    if (aircraft.emergency && aircraft.emergency !== 'none') return { hasEmergency: true };
    if (aircraft.squawk && conf.emergencySquawks.includes(aircraft.squawk)) return { hasEmergency: true };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'emergency',
    name: 'Aircraft in emergency',
    priority: 1,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.conf.emergencySquawks = this.conf.emergencySquawks || ['7500', '7600', '7700'];
    },
    preprocess: (aircraft) => {
        aircraft.calculated.emergency = { hasEmergency: false };
        const emergency = detectEmergency(this.conf, aircraft);
        if (emergency) aircraft.calculated.emergency = emergency;
    },
    evaluate: (aircraft) => aircraft.calculated.emergency.hasEmergency,
    sort: (_a, _b) => 0,
    format: (aircraft) => ({
        text: `EMERGENCY ${aircraft.emergency || aircraft.squawk}`,
        warn: true,
    }),
    debug: (type, _aircraft) => {
        if (type == 'sorting') return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
