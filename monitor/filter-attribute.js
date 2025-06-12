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

    // Leftover!
    civilian: { priority: 13, warn: false, color: 'black' },
};

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
        this.categoriesSuppressed = ['civilian']; // XXX

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

        this.detectors.filter((detector) => detector.enabled && detector.module.getDetectors).forEach((detector) => detector.module.getDetectors().forEach((d) => this.anomalyDetector.addDetector(d)));

        console.error(
            `filter-attribute: ${this.anomalyDetector.detectors.length} detectors active, ${this.detectors.length} modules: ${this.detectors
                .filter((detector) => detector.enabled)
                .map((detector) => detector.module.id)
                .join(', ')}`
        );
    },
    preprocess: (aircraft, context) => {
        aircraft.calculated.specific = { hasMatches: false };
        aircraft.calculated.military = { isMilitary: false };

        // Run preprocessing for all detectors
        this.detectors.filter((detector) => detector.enabled && detector.module.preprocess).forEach((detector) => detector.module.preprocess(aircraft, context));

        // Get ALL matches (no suppression yet)
        const allMatches = this.detectors.filter((detector) => detector.enabled && detector.module.detect).flatMap((detector) => detector.module.detect(this.conf, aircraft, COMMON_CATEGORIES) ?? []);

        // Run anomaly detection with ALL matches
        const anomalies =
            this.anomalyDetector?.detect(aircraft, {
                matches: allMatches,
                categories: this.categories,
                extra: this.extra,
            }) ?? [];

        // Apply suppression for final output
        const matches = allMatches.filter((match) => !this.categoriesSuppressed?.includes(match.category));

        // Build final data structure
        if (matches.length > 0 || anomalies.length > 0) {
            // Sort  matches by priority
            matches.sort((a, b) => (COMMON_CATEGORIES[a.category]?.priority || 999) - (COMMON_CATEGORIES[b.category]?.priority || 999));
            aircraft.calculated.specific = {
                hasMatches: matches.length > 0,
                matches: matches.length > 0 ? matches : undefined,
                primaryMatch: matches.length > 0 ? matches[0] : undefined,
                hasAnomalies: anomalies.length > 0,
                anomalies: anomalies.length > 0 ? anomalies.sort((a, b) => sortBySeverity(a, b, (a, b) => b.confidence - a.confidence)) : undefined,
                highestSeverity: anomalies.length > 0 ? getHighestSeverity(anomalies, 'severity') : undefined,
            };

            // Legacy flag
            if (allMatches.some((m) => m.category === 'military')) {
                aircraft.calculated.military = { isMilitary: true };
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.specific.hasMatches || aircraft.calculated.specific.hasAnomalies,
    sort: (a, b) => {
        const a_ = a.calculated.specific;
        const b_ = b.calculated.specific;

        if (a_.hasMatches && b_.hasMatches) {
            // Both have matches - sort by category priority
            const aCat = COMMON_CATEGORIES[a_.primaryMatch.category],
                bCat = COMMON_CATEGORIES[b_.primaryMatch.category];
            if (aCat.priority !== bCat.priority) return aCat.priority - bCat.priority;
            // Then by confidence
            return (b_.primaryMatch.confidence || 1) - (a_.primaryMatch.confidence || 1);
        }

        if (a_.hasAnomalies && b_.hasAnomalies) {
            // Both have anomalies - sort by severity
            return sortBySeverity({ severity: a_.highestSeverity }, { severity: b_.highestSeverity });
        }

        return 0;
    },

    getStats: (aircrafts, list) => {
        const byCategory = {};
        const byDetector = {};
        const bySource = {};
        const byAnomalyType = {};
        let specificCount = 0,
            anomalyCount = 0;

        list.forEach((aircraft) => {
            const { specific } = aircraft.calculated;

            // Handle matches
            if (specific.hasMatches) {
                byCategory[specific.primaryMatch.category] = (byCategory[specific.primaryMatch.category] || 0) + 1;
                specificCount++;
                specific.matches.forEach((match) => {
                    byDetector[match.detector] = (byDetector[match.detector] || 0) + 1;
                    if (match.field) {
                        bySource[match.field] = (bySource[match.field] || 0) + 1;
                    }
                });
            }

            // Handle anomalies
            if (specific.hasAnomalies) {
                anomalyCount++;
                specific.anomalies.forEach((anomaly) => {
                    byAnomalyType[anomaly.type] = (byAnomalyType[anomaly.type] || 0) + 1;
                });
            }
        });

        return {
            byCategory,
            byDetector,
            bySource,
            byAnomalyType,
            total: list.length,
            matchCount: specificCount,
            anomalyCount,
            // Breakdown of what triggered the detection
            detectionTypes: {
                matchesOnly: specificCount - list.filter((a) => a.calculated.specific.hasAnomalies).length,
                anomaliesOnly: anomalyCount - specificCount,
                both: list.filter((a) => a.calculated.specific.primaryMatch && a.calculated.specific.hasAnomalies).length,
            },
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
