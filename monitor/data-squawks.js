// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const path = require('path');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// XXX reimplement codes as a map/tree for better lookup

function findSquawkByCode(squawkCodes, code) {
    const codeNum = Number.parseInt(code, 10);
    if (squawkCodes === undefined || Number.isNaN(codeNum)) return [];
    return squawkCodes.filter((entry) => entry.beginNum === codeNum || (entry.endNum !== undefined && codeNum >= entry.beginNum && codeNum <= entry.endNum));
}

function findSquawksByType(squawkCodes, type) {
    if (squawkCodes === undefined || !type) return [];
    return squawkCodes.filter((entry) => entry.type === type);
}

function getAllSquawkTypes(squawkCodes) {
    if (squawkCodes === undefined) return new Set();
    return new Set(squawkCodes.map((entry) => entry.type).filter(Boolean));
}

function squawkDataAnalysis(squawkCodes) {
    if (squawkCodes === undefined) return 'no codes loaded';
    const universe = {};
    squawkCodes.forEach((entry) => {
        for (let code = entry.beginNum; code <= (entry.endNum ?? entry.beginNum); code++) universe[code] = (universe[code] || 0) + 1;
    });
    const possible = 8 ** 4,
        unique = Object.keys(universe).length,
        actual = Object.values(universe).reduce((count, number) => count + number, 0);
    return `possible=${possible}, unique=${unique}, actual=${actual}`;
}

function buildSquawkCodes(squawkData) {
    if (squawkData === undefined) return undefined;
    const codes = squawkData.codes
        .map((entry) => {
            if (entry.begin === undefined) return undefined;
            entry.beginNum = Number.parseInt(entry.begin, 10);
            if (Number.isNaN(entry.beginNum)) return undefined;
            if (entry.end) {
                entry.endNum = Number.parseInt(entry.end, 10);
                if (Number.isNaN(entry.endNum)) return undefined;
            }
            return entry;
        })
        .filter(Boolean);
    if (codes.length != squawkData.codes.length) console.error(`squawkData: trimmed out ${squawkData.codes.length - codes.length} bad entries`);
    return codes;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function initialise(options, data) {
    let squawkData, squawkCodes;
    try {
        squawkData = require(path.join(data?.directory, options?.file));
    } catch (e) {
        console.error('squawkData: not available:', e);
    }
    if (squawkData?.codes) {
        squawkCodes = buildSquawkCodes(squawkData);
        console.error(`squawkData: ${squawkDataAnalysis(squawkCodes)}`);
    } else console.error('squawkData: codes not available');

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
