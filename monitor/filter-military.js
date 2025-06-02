// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectMilitary(conf, aircraft) {
    if (aircraft.flight && conf.militaryPrefixes.some((prefix) => aircraft.flight.trim().startsWith(prefix))) return { isMilitary: true };
    if (aircraft.flight && /^[A-Z]{4}\d{2}$/.test(aircraft.flight)) return { isMilitary: true };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'military',
    name: 'Aircraft military',
    priority: 6,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.conf.militaryPrefixes = this.conf.militaryPrefixes || [
            'RCH',
            'PLF',
            'RRR',
            'ASY',
            'RFF',
            'HVK',
            'CFC',
            'HRZ',
            'EEF',
            'FNF',
            'BAF',
            'GAF',
            'GAM',
            'RFR',
            'NVY',
            'CNV',
            'CHD',
            'DOD',
            'AAC',
            'SHF',
            'SUI',
            'SVF',
            'AME',
            'SIV',
            'SQF',
            'ROF',
            'AFP',
            'PNY',
            'NOW',
            'KIW',
            'NAF',
            'LAF',
            'IFC',
            'HUF',
            'HAF',
            'FAF',
            'FMY',
            'FNY',
            'DAF',
            'CEF',
            'ASF',
            'RSD',
            'IAM',
            'AFB',
            'CXG',
            'MMF',
            'AYB',
            'NOH',
            'WAD',
            'PAT',
            'UNO',
            'RSF',
            'DNY',
            'AIO',
            'UAF',
            'QID',
        ];
    },
    preprocess: (aircraft) => {
        aircraft.calculated.military = { isMilitary: false };
        const military = detectMilitary(this.conf, aircraft);
        if (military) aircraft.calculated.military = military;
    },
    evaluate: (aircraft) => aircraft.calculated.military.isMilitary,
    sort: (_a, _b) => 0,
    format: () => ({
        text: `military`,
        warn: true,
    }),
    debug: (type, _aircraft) => {
        if (type == 'sorting') return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
