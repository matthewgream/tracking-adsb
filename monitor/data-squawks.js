// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const path = require('path');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function findSquawkByCode(squawkCodes, code) {
    if (squawkCodes === undefined || !code) return [];
    const codeNum = Number.parseInt(code, 10);
    if (Number.isNaN(codeNum)) return [];
    return squawkCodes.mapOfSquawks[codeNum] || [];
}

function findSquawksByType(squawkCodes, type) {
    if (squawkCodes === undefined || !type) return [];
    return squawkCodes.mapOfTypes[type] || [];
}

function getAllSquawkTypes(squawkCodes) {
    if (squawkCodes === undefined) return new Set();
    return new Set(Object.keys(squawkCodes.mapOfTypes));
}

function squawkDataAnalysis(squawkCodes) {
    if (squawkCodes === undefined) return 'no codes loaded';
    const possible = 8 ** 4;
    const unique = Object.keys(squawkCodes.mapOfSquawks).length;
    const actual = Object.values(squawkCodes.mapOfSquawks).reduce((count, entries) => count + entries.length, 0);
    const types = [...new Set(Object.keys(squawkCodes.mapOfTypes))];
    return `codes: possible=${possible}, unique=${unique}, actual=${actual}, types: count=${types.length}`;
}

function buildSquawkCodes(squawkData) {
    if (squawkData === undefined) return undefined;

    const mapOfSquawks = {},
        mapOfTypes = {};
    let badEntries = 0;

    squawkData.codes.forEach((entry) => {
        if (entry.begin === undefined) {
            badEntries++;
            return;
        }
        const beginNum = Number.parseInt(entry.begin, 10);
        if (Number.isNaN(beginNum)) {
            badEntries++;
            return;
        }
        let endNum = beginNum;
        if (entry.end) {
            endNum = Number.parseInt(entry.end, 10);
            if (Number.isNaN(endNum)) {
                badEntries++;
                return;
            }
        }
        entry.beginNum = beginNum;
        entry.endNum = endNum;
        for (let code = beginNum; code <= endNum; code++) {
            if (!mapOfSquawks[code]) mapOfSquawks[code] = [];
            mapOfSquawks[code].push(entry);
        }
        if (entry.type) {
            if (!mapOfTypes[entry.type]) mapOfTypes[entry.type] = [];
            mapOfTypes[entry.type].push(entry);
        }
    });
    if (badEntries > 0) console.error(`squawks: data prunned ${badEntries} bad entries`);
    return {
        mapOfSquawks,
        mapOfTypes,
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function initialise(options, data) {
    let squawkData, squawkCodes;
    try {
        squawkData = require(path.join(data?.directory, options?.file));
    } catch (e) {
        console.error('squawks: codes not available:', e);
    }
    if (squawkData?.codes) squawkCodes = buildSquawkCodes(squawkData);
     else console.error('squawks: codes not available: no content');

    return {
        getInfo: () => squawkDataAnalysis(squawkCodes),
        findByCode: (code) => findSquawkByCode(squawkCodes, code),
        findByType: (type) => findSquawksByType(squawkCodes, type),
        getAllTypes: () => getAllSquawkTypes(squawkCodes),
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = function (options, data) {
    return initialise(options, data);
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
