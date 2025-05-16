// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    link: 'http://adsb.local/adsbx/data/aircraft.json',
    airports: {
        apply: {
            EGLW: {
                radius: 0.5,
                height: 1500,
            },
        },
    },
    flights: {
        exclude: ['TEST1234'],
    },
    filters: {
        emergency: {},
        military: {},
        airport: {
            priorities: ['EGLW'],
        },
        anomaly: {},
        weather: {},
        vicinity: {
            distance: 10,
            altitude: 10000,
        },
        overhead: {
            radius: 5, // will intersect within 5km of station
            time: 30 * 60, // currently less than 30mins out
            distance: 20, // currently less than 20km out
            altitude: 20000, // currently less than 20000 ft
        },
        landing: {
            radius: 10, // will intersect within 10km of current position
            distance: 100, // currently less than 100km out
            altitude: 2500, // currently less than 20000 ft
        },
        lifting: {
            altitude: 2500, // Maximum altitude to consider for takeoff detection
            radius: 5 * 1.852, // Radius to search for departure airports (km)
            minClimbRate: 300, // Minimum climb rate to consider as takeoff (ft/min)
        },
        airprox: {
            horizontalThreshold: 1.0, // NM
            verticalThreshold: 1000, // feet
            airportExclusionRadius: 5, // km
        },
        specific: {
            flights: [
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
            ],
        },
    },
    location: {
        address: 'SW1A 1AA',
        lat: 51.501126,
        lon: -0.14239,
        alt: 15,
    },
    publish: {
        mqtt: {
            enabled: true,
            server: 'mqtt://localhost:1883',
            clientId: 'adsb-monitor',
            publishTopics: {
                alert: 'adsb/alert',
                state: 'adsb/state',
            },
            debug: false,
        },
    },
    display: {},
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
