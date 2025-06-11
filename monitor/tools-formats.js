// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js') };
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

function getAlignmentQualityText(alignedRunway) {
    if (alignedRunway.isGoodAlignment) return 'good';
    if (alignedRunway.isModerateAlignment) return 'moderate';
    if (alignedRunway.isPoorAlignment) return 'poor';
    return 'undefined';
}

/**
 * Build comprehensive format object for a single airport
 * Returns both structured data and formatted text
 * @param {Object} airport - Enhanced airport object with distance, phase, runway alignment, etc.
 * @param {Object} options - Formatting options
 * @returns {Object} { text: string, data: object }
 */
function buildAirportFormat(airport, options = {}) {
    const { includeDistance = true, includeRunway = true, includePhase = true, includeConfidence = true } = options;

    // Build structured data
    const data = {
        icao_code: airport.icao_code,
        iata_code: airport.iata_code,
        name: airport.name,
        type: airport.type,
        distance: airport.distance ? Number(airport.distance.toFixed(1)) : undefined,
        distanceNm: airport.distanceNm ? Number(airport.distanceNm.toFixed(1)) : undefined,
    };

    // Add phase information if available
    if (airport.phase) {
        data.phase = airport.phase;
        if (airport.phaseConfidence) {
            data.phaseConfidence = Number(airport.phaseConfidence.toFixed(2));
        }
    }

    // Add runway alignment information if available
    if (airport.alignedRunway) {
        data.alignedRunway = {
            runway: airport.alignedRunway.runwayName,
            alignmentScore: Number(airport.alignedRunway.alignmentScore.toFixed(2)),
            confidenceScore: Number(airport.alignedRunway.confidenceScore.toFixed(2)),
            quality: getAlignmentQualityText(airport.alignedRunway),
        };
    }

    // Add relevance score if available
    if (airport.relevanceScore !== undefined) {
        data.relevanceScore = Number(airport.relevanceScore.toFixed(2));
    }

    // Build text description
    let text = formatAirport(airport); // Use existing function for basic format

    // Add phase to text
    if (includePhase && airport.phase) {
        text = `${airport.phase} ${text}`;
    }

    // Add runway information to text
    if (includeRunway && airport.alignedRunway) {
        if (airport.alignedRunway.isGoodAlignment) {
            text += ` runway ${airport.alignedRunway.runwayName}`;
            if (includeConfidence) {
                text += ` (${Math.round(airport.alignedRunway.confidenceScore * 100)}% conf)`;
            }
        } else if (airport.alignedRunway.isModerateAlignment) {
            text += ` possibly runway ${airport.alignedRunway.runwayName}`;
        }
    }

    // Add distance to text
    if (includeDistance && airport.distance) {
        text += ` [${airport.distance.toFixed(1)}km]`;
    }

    return { text, data };
}

/**
 * Build comprehensive format for multiple airports
 * Handles primary airport with additional airports summary
 * @param {Array} airports - Array of enhanced airport objects
 * @param {Object} options - Formatting options
 * @returns {Object} { text: string, airports: array, summary: object }
 */
function buildAirportsFormat(airports, options = {}) {
    const {
        maxAirports = 3,
        primaryOnly = false,
        sortBy = 'relevanceScore', // or 'distance'
    } = options;

    if (!airports || airports.length === 0) {
        return {
            text: 'no airports nearby',
            airports: [],
            summary: { total: 0, shown: 0 },
        };
    }

    // Sort airports
    const sorted = [...airports].sort((a, b) => (sortBy === 'distance' ? (a.distance || Infinity) - (b.distance || Infinity) : (b[sortBy] || 0) - (a[sortBy] || 0)));

    // Get airports to format
    const airportsToFormat = primaryOnly ? sorted.slice(0, 1) : sorted.slice(0, maxAirports);

    // Format each airport
    const formattedAirports = airportsToFormat.map((apt) => buildAirportFormat(apt, options));

    // Build primary text
    let text = '';
    const [primary] = formattedAirports;

    if (primary) {
        ({ text } = primary);

        // Add count of additional airports if relevant
        if (!primaryOnly && airports.length > 1) {
            const additionalCount = airports.length - 1;
            const shownCount = Math.min(additionalCount, maxAirports - 1);

            if (shownCount > 0) {
                // List the additional airports briefly
                const additionalTexts = formattedAirports.slice(1).map((apt) => `${apt.data.icao_code || apt.data.name}`);
                text += ` (also: ${additionalTexts.join(', ')}`;

                if (additionalCount > shownCount) {
                    text += ` +${additionalCount - shownCount} more`;
                }
                text += ')';
            } else if (additionalCount > 0) {
                text += ` (+${additionalCount} other${additionalCount > 1 ? 's' : ''})`;
            }
        }
    }

    return {
        text,
        airports: formattedAirports.map((f) => f.data),
        summary: {
            total: airports.length,
            shown: airportsToFormat.length,
            primary: formattedAirports[0]?.data,
        },
    };
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
    // NEW
    buildAirportFormat,
    buildAirportsFormat,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
