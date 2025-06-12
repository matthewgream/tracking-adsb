// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Main filter-specific coordinator - manages all specific detection modules
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const { AnomalyDetector, sortBySeverity, getHighestSeverity } = require('./filter-common.js');

const callsignDetector = require('./filter-attribute-callsign.js');
const hexcodeDetector = require('./filter-attribute-hexcode.js');
const squawkDetector = require('./filter-attribute-squawk.js');
const crosscheckDetector = require('./filter-attribute-crosscheck.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// Common category definitions shared across all detection modules
const COMMON_CATEGORIES = {
    // Priority 1-3: Critical/Government
    royalty: { priority: 1, warn: true, color: 'purple' },
    government: { priority: 2, warn: true, color: 'red' },
    'emergency-services': { priority: 3, warn: true, color: 'orange' },

    // Priority 4-6: Military/Operations
    'military-transport': { priority: 4, warn: true, color: 'green' },
    'special-ops': { priority: 5, warn: true, color: 'darkgreen' },
    military: { priority: 6, warn: true, color: 'olive' },

    // Priority 7-9: Commercial/Testing
    vip: { priority: 7, warn: true, color: 'gold' },
    test: { priority: 8, warn: true, color: 'blue' },
    survey: { priority: 9, warn: false, color: 'lightblue' },

    // Priority 10+: General interest
    'special-interest': { priority: 10, warn: false, color: 'gray' },
    historic: { priority: 11, warn: false, color: 'brown' },
    surveillance: { priority: 12, warn: false, color: 'darkgray' },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectSpecific(conf, aircraft, detectors) {
    const allMatches = [];

    // Run each detector and collect matches
    for (const detector of detectors) {
        if (!detector.enabled) continue;

        const matches = detector.detect(conf, aircraft, COMMON_CATEGORIES);
        if (matches && matches.length > 0) {
            allMatches.push(...matches);
        }
    }

    if (allMatches.length === 0) return undefined;

    // Sort matches by priority
    allMatches.sort((a, b) => {
        const aPri = COMMON_CATEGORIES[a.category]?.priority || 999;
        const bPri = COMMON_CATEGORIES[b.category]?.priority || 999;
        return aPri - bPri;
    });

    return {
        isSpecific: true,
        matches: allMatches,
        primaryMatch: allMatches[0],
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'attribute',
    name: 'Specific aircraft tracking',
    priority: 3,
    config: (conf, extra) => {
        this.conf = conf;
        this.extra = extra;

        this.categories = COMMON_CATEGORIES;

        this.detectors = [
            {
                module: callsignDetector,
                enabled: conf?.callsign?.enabled !== false,
            },
            {
                module: hexcodeDetector,
                enabled: conf?.hexcode?.enabled !== false,
            },
            {
                module: squawkDetector,
                enabled: conf?.squawk?.enabled !== false,
            },
            {
                module: crosscheckDetector,
                enabled: conf?.crosscheck?.enabled !== false,
            },
        ];
        this.detectors.filter((detector) => detector.enabled && detector.module.config).forEach((detector) => detector.module.config(conf?.[detector.module.id] ?? {}, extra, COMMON_CATEGORIES));
        this.anomalyDetector = new AnomalyDetector('attribute');
        this.anomalyDetector.setEnabled(conf?.detectAnomalies !== false);
        this.detectors.filter((detector) => detector.enabled && detector.module.detectors).forEach((detector) => detector.module.detectors?.forEach((d) => this.anomalyDetector.addDetector(d)));

        console.error(
            `filter-attribute: ${this.anomalyDetector.detectors.length} detectors active, ${this.detectors.length} modules: ${this.detectors
                .filter((detector) => detector.enabled)
                .map((detector) => detector.module.id)
                .join(', ')}`
        );
    },
    preprocess: (aircraft, context) => {
        aircraft.calculated.specific = { isSpecific: false };
        aircraft.calculated.military = { isMilitary: false };

        this.detectors.filter((detector) => detector.enabled && detector.module.preprocess).forEach((detector) => detector.module.preprocess(aircraft, context));

        const specific = detectSpecific(
            this.conf,
            aircraft,
            this.detectors.map((d) => d.module)
        );
        if (specific) {
            aircraft.calculated.specific = specific;

            // Run anomaly detection
            const anomalies =
                this.anomalyDetector?.detect(aircraft, {
                    matches: specific.matches,
                    categories: this.categories,
                    extra: this.extra,
                }) ?? [];

            if (anomalies.length > 0) {
                aircraft.calculated.specific.anomalies = anomalies.sort((a, b) => sortBySeverity(a, b, (a, b) => b.confidence - a.confidence));
                aircraft.calculated.specific.hasAnomalies = true;
                aircraft.calculated.specific.highestSeverity = getHighestSeverity(anomalies, 'severity');
            }

            // Set legacy flags for backward compatibility
            if (specific.matches.some((m) => m.category === 'military')) {
                aircraft.calculated.military = { isMilitary: true };
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.specific.isSpecific || aircraft.calculated.specific.hasAnomalies,
    sort: (a, b) => {
        const aCat = COMMON_CATEGORIES[a.calculated.specific.primaryMatch.category];
        const bCat = COMMON_CATEGORIES[b.calculated.specific.primaryMatch.category];

        // First sort by priority
        if (aCat.priority !== bCat.priority) {
            return aCat.priority - bCat.priority;
        }

        // Then by detection confidence if available
        const aConf = a.calculated.specific.primaryMatch.confidence || 1;
        const bConf = b.calculated.specific.primaryMatch.confidence || 1;
        return bConf - aConf;
    },
    getStats: (aircrafts, list) => {
        const byCategory = {};
        const byDetector = {};
        const bySource = {};

        list.forEach((aircraft) => {
            const { specific } = aircraft.calculated;

            // Category stats
            const { category } = specific.primaryMatch;
            byCategory[category] = (byCategory[category] || 0) + 1;

            // Detector stats
            specific.matches.forEach((match) => {
                byDetector[match.detector] = (byDetector[match.detector] || 0) + 1;

                // Source field stats (what field matched)
                if (match.field) {
                    bySource[match.field] = (bySource[match.field] || 0) + 1;
                }
            });
        });

        return {
            byCategory,
            byDetector,
            bySource,
            total: list.length,
        };
    },
    format: (aircraft) => {
        const { specific } = aircraft.calculated;

        // Handle anomalies first
        if (specific.hasAnomalies) {
            const [primary] = specific.anomalies;
            const count = specific.anomalies.length;
            const suffix = count > 1 ? ` (+${count - 1} more)` : '';

            return {
                text: `${primary.description}${suffix}`,
                warn: specific.highestSeverity === 'high',
                color: 'red',
                specificInfo: {
                    anomalies: specific.anomalies,
                    matches: specific.matches,
                    category: specific.primaryMatch?.category,
                    detector: specific.primaryMatch?.detector,
                },
            };
        }

        // Original formatting for matches
        const match = specific.primaryMatch;
        const categoryInfo = COMMON_CATEGORIES[match.category];

        const categoryFormatted = match.category
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        return {
            text: `${categoryFormatted}: ${match.description}`,
            warn: categoryInfo.warn,
            color: categoryInfo.color,
            specificInfo: {
                matches: specific.matches,
                category: match.category,
                description: match.description,
                detector: match.detector,
                confidence: match.confidence,
            },
        };
    },
    debug: (type, aircraft) => {
        const { specific } = aircraft.calculated;
        if (type === 'sorting') {
            const cat = COMMON_CATEGORIES[specific.primaryMatch.category];
            return `${specific.primaryMatch.category} (pri=${cat.priority}, conf=${specific.primaryMatch.confidence || 1})`;
        }
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
