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
            { field: 'flight', pattern: '^(TKF)[0-9]', category: 'royalty', description: "The King's Flight" },
            //
            { field: 'flight', pattern: '^(EXEC|STATE|GOV)[0-9]', category: 'government', description: 'Government flight' },
            { field: 'flight', pattern: '^CAF', category: 'government', description: 'Canadian Air Force' },
            { field: 'flight', pattern: '^RRF', category: 'government', description: 'French Republic flight' },
            //{ pattern: '^(BAW|VJT|G-)[A-Z]{4}', category: 'vip', description: 'Potential VIP flight' },
            // Special operators
            { field: 'flight', pattern: '^(CKS|CPT|RCH)', category: 'special-ops', description: 'Special operations' }, // not BOX/CMB/NPT
            { field: 'flight', pattern: '^(DUKE|ASCOT|REACH|ROCKY)', category: 'military-transport', description: 'Military transport' },
            // Test flights
            { field: 'flight', pattern: '^(N|D|G|F|HB)-[A-Z]{3}', category: 'test', description: 'Possible test flight' },
            { field: 'flight', pattern: '^(TEST|XCL|XCH|XAS)', category: 'test', description: 'Test flight' },
            // Emergency services
            { field: 'flight', pattern: '^(HEMS|HELIMED|RESCUE)', category: 'emergency-services', description: 'Air ambulance' },
            { field: 'flight', pattern: '^(POLICE|NPAS)', category: 'emergency-services', description: 'Police aircraft' },
            { field: 'flight', pattern: '^(PIPELINE|SURVEY)', category: 'survey', description: 'Aerial survey' },
            // Custom watchlist
            { field: 'flight', pattern: '^(RETRO|HISTORIC)', category: 'special-interest', description: 'Historic aircraft' },
            // types
            { field: 'category', pattern: 'B7', category: 'special-interest', description: 'Space aircraft' },
            { field: 'category', pattern: '[CD][0-9]', category: 'special-interest', description: 'Special aircraft' },
        ];
        this.flightsCompiled = this.flights.map((p) => ({ ...p, regex: new RegExp(p.pattern, 'i') }));
        this.categoryPriorities = this.conf.priorities || {
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
    },
    preprocess: (aircraft) => {
        aircraft.calculated.specific = {
            matches: this.flightsCompiled.filter((p) => aircraft?.[p.field] && p.regex.test(aircraft[p.field])).map(({ regex, ...rest }) => rest), // eslint-disable-line no-unused-vars
        };
    },
    evaluate: (aircraft) => aircraft.calculated.specific.matches.length > 0,
    sort: (a, b) => {
        const catA = this.categoryPriorities[a.calculated.specific.matches?.[0].category] || 999,
            catB = this.categoryPriorities[b.calculated.specific.matches?.[0].category] || 999;
        return catA === catB ? a.calculated.distance - b.calculated.distance : catA - catB;
    },
    getStats: (aircrafts) => {
        const list = aircrafts.filter((a) => a.calculated.specific.matches.length > 0);
        const byCategory = list
            .map((aircraft) => aircraft.calculated.specific.matches[0].category)
            .reduce((counts, category) => ({ ...counts, [category]: (counts[category] || 0) + 1 }), {});
        return {
            ...this.extra.format.getStats_List('aircraft-specific', list),
            byCategory,
        };
    },
    format: (aircraft) => {
        const { specific } = aircraft.calculated;
        const [matchPrimary] = specific.matches;
        const categoryFormatted = matchPrimary.category
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        return {
            text: `${categoryFormatted}: ${matchPrimary.description}`,
            warn: true,
            specificInfo: {
                matches: specific.matches,
                category: matchPrimary.category,
                description: matchPrimary.description,
            },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
