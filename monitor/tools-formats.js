// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };
const aircraft_info = require('./aircraft-info.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function formatSecondsNicely(s) {
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60 ? (s % 60) + 's' : '');
    if (s < 86400) return Math.floor(s / 3600) + 'h' + (Math.floor((s % 3600) / 60) + 'm') + (s % 60 ? (s % 60) + 's' : '');
    return Math.floor(s / 86400) + 'd' + (Math.floor((s % 86400) / 3600) + 'h') + (Math.floor((s % 3600) / 60) + 'm') + (s % 60 ? (s % 60) + 's' : '');
}

function formatAltitude(altitude) {
    // Standard transition level in the UK is generally FL70 (7,000 ft)
    // London TMA uses varying transition altitudes, but 6,000 ft is common
    const transitionLevel = 7000;
    if (altitude === undefined) return 'n/a';
    if (altitude >= transitionLevel) return `FL${Math.round(altitude / 100)}`;
    if (altitude === 0) return 'ground';
    return `${altitude.toLocaleString()} ft`;
}

function formatStatsList(name, list) {
    return {
        count: list.length,
        description: `${name}: ${list.length}` + (list.length > 0 ? ': ' + list.map((aircraft) => aircraft.flight).join(', ') : ''),
    };
}

function formatAirport(airport) {
    const { name, icao_code } = airport || {};
    if (name && icao_code) return `${icao_code} [${name}]`;
    if (name) return name;
    if (icao_code) return icao_code;
    return '';
}

function formatVerticalAngle(angle) {
    if (angle < 0) return 'below horizon'; // For very distant aircraft below observer altitude
    if (angle < 5) return 'just above horizon';
    if (angle < 15) return 'low in sky';
    if (angle < 30) return 'midway up';
    if (angle < 60) return 'high in sky';
    if (angle < 80) return 'nearly overhead';
    return 'directly overhead';
}

function formatTimePhrase(seconds, isFuture) {
    const totalSecs = Math.abs(seconds);
    const mins = Math.floor(totalSecs / 60),
        secs = totalSecs % 60;
    if (isFuture) {
        if (totalSecs < 30) return `in ${totalSecs} seconds`;
        if (totalSecs < 90) return secs > 45 ? `in just over a minute` : `in about a minute`;
        if (mins < 5) return secs > 30 ? `in about ${mins + 1} minutes` : `in about ${mins} minutes`;
        return `in about ${mins} minutes`;
    } else {
        if (totalSecs < 30) return `just now`;
        if (totalSecs < 90) return `about a minute ago`;
        return `about ${mins} minutes ago`;
    }
}

function formatCategoryCode(categoryCode) {
    if (!categoryCode) return '';
    const description = aircraft_info.getAircraftCategoryInfo[categoryCode]?.description;
    return description ? `${categoryCode}: ${description}` : `${categoryCode}`;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    formatAltitude,
    formatAirport,
    formatVerticalAngle,
    formatTimePhrase,
    formatCategoryCode,
    formatStatsList,
    formatSecondsNicely,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
