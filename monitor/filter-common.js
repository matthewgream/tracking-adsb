// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const SEVERITY_LEVELS = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
};

function getHighestSeverity(items, severityField = 'severity') {
    if (!items || items.length === 0) return 'info';
    return items.map((item) => item[severityField]).reduce((highest, severity) => (SEVERITY_LEVELS[severity] > SEVERITY_LEVELS[highest] ? severity : highest), 'info');
}

function compareSeverity(a, b, severityField = 'severity') {
    return SEVERITY_LEVELS[b[severityField]] - SEVERITY_LEVELS[a[severityField]];
}

function sortBySeverity(a, b, n) {
    const severityDiff = SEVERITY_LEVELS[b.severity] - SEVERITY_LEVELS[a.severity];
    if (severityDiff !== 0) return severityDiff;
    return n === undefined ? 0 : n(a, b);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AnomalyDetector {
    constructor(name) {
        this.name = name;
        this.detectors = [];
        this.enabled = true;
        this.stats = {
            totalChecks: 0,
            totalAnomalies: 0,
            byType: {},
            bySeverity: {},
        };
    }

    // Register a detector function
    // Detector should return null/undefined for no anomaly, or an anomaly object/array
    addDetector(detector) {
        if (typeof detector !== 'function') {
            throw new TypeError('Detector must be a function');
        }
        this.detectors.push(detector);
    }

    // Run all detectors on an aircraft
    detect(aircraft, context = {}) {
        if (!this.enabled) return [];

        this.stats.totalChecks++;
        const anomalies = [];

        for (const detector of this.detectors) {
            try {
                const result = detector(aircraft, context);
                if (result) {
                    const items = Array.isArray(result) ? result : [result];
                    // Validate and enhance each anomaly
                    items.forEach((anomaly) => {
                        if (this.validateAnomaly(anomaly)) {
                            // Add detector name if not present
                            if (!anomaly.detector) {
                                anomaly.detector = detector.name || 'unknown';
                            }
                            anomalies.push(anomaly);
                            this.updateStats(anomaly);
                        }
                    });
                }
            } catch (e) {
                console.error(`Anomaly detector error in ${this.name}:`, e);
            }
        }

        if (anomalies.length > 0) {
            this.stats.totalAnomalies++;
        }

        return anomalies;
    }

    // Validate anomaly structure
    validateAnomaly(anomaly) {
        if (!anomaly || typeof anomaly !== 'object') return false;

        // Required fields
        if (!anomaly.type || !anomaly.description) {
            console.warn('Anomaly missing required fields:', anomaly);
            return false;
        }

        // Set defaults
        anomaly.severity = anomaly.severity || 'low';
        anomaly.confidence = anomaly.confidence || 0.5;

        // Validate severity
        if (!['low', 'medium', 'high'].includes(anomaly.severity)) {
            anomaly.severity = 'low';
        }

        // Validate confidence
        if (typeof anomaly.confidence !== 'number' || anomaly.confidence < 0 || anomaly.confidence > 1) {
            anomaly.confidence = 0.5;
        }

        return true;
    }

    // Update statistics
    updateStats(anomaly) {
        // By type
        this.stats.byType[anomaly.type] = (this.stats.byType[anomaly.type] || 0) + 1;

        // By severity
        this.stats.bySeverity[anomaly.severity] = (this.stats.bySeverity[anomaly.severity] || 0) + 1;
    }

    // Get statistics
    getStats() {
        return {
            ...this.stats,
            detectorCount: this.detectors.length,
            enabled: this.enabled,
        };
    }

    // Clear statistics
    clearStats() {
        this.stats.totalChecks = 0;
        this.stats.totalAnomalies = 0;
        this.stats.byType = {};
        this.stats.bySeverity = {};
    }

    // Enable/disable anomaly detection
    setEnabled(enabled) {
        this.enabled = enabled;
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    //
    SEVERITY_LEVELS,
    compareSeverity,
    getHighestSeverity,
    sortBySeverity,
    //
    AnomalyDetector,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
