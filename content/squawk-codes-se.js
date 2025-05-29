
// eAIP SWEDEN
// ENR 1.6.3
// https://aro.lfv.se/Editorial/View/IAIP

module.exports = {
  codes: [
    // 0xxx Series

    // 1xxx Series

    // 2xxx Series

    // 3xxx Series

    // 4xxx Series

    // 5xxx Series

    // 6xxx Series

    // 7xxx Series
    { begin: '7000', description: ['VFR Conspicuity'], type: 'conspicuity', details: ['The transponder shall be set to a code as instructed by ATS or, if no such instruction has been received, on code 7000'] },
    { begin: '7600', description: ['Radio Failure'], type: 'emergency', details: ['In the event of a radio communication failure, mode A code 7600 shall be selected'] },
    { begin: '7700', description: ['Emergency'], type: 'emergency', details: ['An aircraft encountering an emergency and having previously been instructed by ATS to operate the transponder on a specific code shall maintain this code setting unless otherwise advised by ATS. Under all other circumstances the transponder shall be set to mode A code 7700'] },
  ]
};

