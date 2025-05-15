// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

//const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'specific',
    name: 'Specific flight tracking',
    enabled: true,
    priority: 3, // Medium priority (same as overhead)
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;
        this.flights = this.conf.flights || [
            // Government & VIP flights
            { pattern: '^(EXEC|STATE|GOV)[0-9]', category: 'government', description: 'Government flight' },
            { pattern: '^CAF', category: 'government', description: 'Canadian Air Force' },
            { pattern: '^RRF', category: 'government', description: 'French Republic flight' },
            { pattern: '^(BAW|VJT|G-)[A-Z]{4}', category: 'vip', description: 'Potential VIP flight' },
            // Special operators
            { pattern: '^(CKS|CPT|NPT|RCH|CMB|BOX)', category: 'special-ops', description: 'Special operations' },
            { pattern: '^(DUKE|ASCOT|REACH|ROCKY)', category: 'military-transport', description: 'Military transport' },
            // Test flights
            { pattern: '^(N|D|G|F|HB)-[A-Z]{3}', category: 'test', description: 'Possible test flight' },
            { pattern: '^(TEST|XCL|XCH|XAS)', category: 'test', description: 'Test flight' },
            // Emergency services
            { pattern: '^(HEMS|HELIMED|RESCUE)', category: 'emergency-services', description: 'Air ambulance' },
            { pattern: '^(POLICE|NPAS)', category: 'emergency-services', description: 'Police aircraft' },
            { pattern: '^(PIPELINE|SURVEY)', category: 'survey', description: 'Aerial survey' },
            // Custom watchlist - add your own
            { pattern: '^(RETRO|HISTORIC)', category: 'special-interest', description: 'Historic aircraft' },
        ];
        this.flightsCompiled = this.flights.map((p) => ({
            ...p,
            regex: new RegExp(p.pattern, 'i'), // Case insensitive
        }));
    },
    preprocess: (aircraft) => {
        aircraft.calculated.specific = { matches: [] };
        if (!aircraft.flight) return;
        const matches = this.flightsCompiled
            .filter((p) => p.regex.test(aircraft.flight))
            .map((p) => ({ pattern: p.pattern, category: p.category, description: p.description }));
        if (matches.length > 0)
            aircraft.calculated.specific = {
                isSpecific: true,
                matches,
                primaryMatch: matches[0],
            };
    },
    evaluate: (aircraft) => {
        return aircraft.calculated.specific.matches.length > 0;
    },
    sort: (a, b) => {
        const categoryPriorities = this.conf.priorities || {
            government: 1,
            'emergency-services': 2,
            'military-transport': 3,
            'special-ops': 4,
            vip: 5,
            test: 6,
            survey: 7,
            'special-interest': 8,
            royalty: 9,
        };
        const catA = categoryPriorities[a.calculated.specific.primaryMatch.category] || 999,
            catB = categoryPriorities[b.calculated.specific.primaryMatch.category] || 999;
        return catA !== catB ? catA - catB : a.calculated.distance - b.calculated.distance;
    },
    getStats: (aircrafts) => {
        const specificAircraft = aircrafts.filter((a) => a.calculated.specific.matches.length > 0);
        const byCategory = specificAircraft
            .map((aircraft) => aircraft.calculated.specific.primaryMatch.category)
            .reduce((counts, category) => ({ ...counts, [category]: (counts[category] || 0) + 1 }), {});
        return {
            ...this.extra.format.getStats_List('aircraft-specific', specificAircraft),
            byCategory,
        };
    },
    format: (aircraft) => {
        const categoryFormatted = aircraft.calculated.specific.primaryMatch.category
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        return {
            text: `${categoryFormatted}: ${aircraft.calculated.specific.primaryMatch.description}`,
            warn: true,
            specificInfo: {
                matches: aircraft.calculated.specific.matches,
                category: aircraft.calculated.specific.primaryMatch.category,
                description: aircraft.calculated.specific.primaryMatch.description,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
