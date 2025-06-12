// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const RELIABILITY_THRESHOLDS = {
    position: {
        maxAge: 30, // seconds
        maxUncertainty: 10, // NM
    },
    altitude: {
        maxAge: 30, // seconds
        maxDiscrepancy: 500, // feet between baro and geom
        minReports: 3, // minimum reports for reliability
    },
    velocity: {
        maxAge: 30, // seconds
        maxAcceleration: 5, // G's - physics limit
    },
};

/**
 * Check reliability of a specific aircraft data field
 * @param {Object} aircraft - Aircraft object
 * @param {string} field - Field to check ('position', 'altitude', 'velocity')
 * @param {Object} options - Optional custom thresholds
 * @returns {Object} Reliability assessment
 */
function isReliable(aircraft, field, options = {}) {
    const thresholds = { ...RELIABILITY_THRESHOLDS[field], ...options };

    switch (field) {
        case 'position':
            return checkPositionReliability(aircraft, thresholds);

        case 'altitude':
            return checkAltitudeReliability(aircraft, thresholds);

        case 'velocity':
            return checkVelocityReliability(aircraft, thresholds);

        default:
            return { reliable: false, reason: 'unknown field type' };
    }
}

function checkPositionReliability(aircraft, thresholds) {
    const issues = [];

    // Check position age
    if (aircraft.seen_pos !== undefined && aircraft.seen_pos > thresholds.maxAge) {
        issues.push({ type: 'stale', age: aircraft.seen_pos });
    }

    // Check if position exists
    if (aircraft.lat === undefined || aircraft.lon === undefined) {
        issues.push({ type: 'missing' });
    }

    // Check position validity
    if (aircraft.lat !== undefined && (aircraft.lat < -90 || aircraft.lat > 90)) {
        issues.push({ type: 'invalid_latitude', value: aircraft.lat });
    }

    if (aircraft.lon !== undefined && (aircraft.lon < -180 || aircraft.lon > 180)) {
        issues.push({ type: 'invalid_longitude', value: aircraft.lon });
    }

    // Check NIC/NAC if available (ADS-B position quality indicators)
    if (aircraft.nic !== undefined && aircraft.nic < 6) {
        issues.push({ type: 'low_integrity', nic: aircraft.nic });
    }

    return {
        reliable: issues.length === 0,
        confidence: issues.length === 0 ? 1 : Math.max(0, 1 - issues.length * 0.3),
        issues,
        field: 'position',
    };
}

function checkAltitudeReliability(aircraft, thresholds) {
    const issues = [];

    // Check if we have altitude data
    if (!aircraft.alt_baro && !aircraft.alt_geom) {
        issues.push({ type: 'missing' });
        return { reliable: false, confidence: 0, issues, field: 'altitude' };
    }

    // Check discrepancy between barometric and geometric altitude
    if (aircraft.alt_baro !== undefined && aircraft.alt_geom !== undefined) {
        const discrepancy = Math.abs(aircraft.alt_baro - aircraft.alt_geom);
        if (discrepancy > thresholds.maxDiscrepancy) {
            issues.push({
                type: 'discrepancy',
                baro: aircraft.alt_baro,
                geom: aircraft.alt_geom,
                diff: discrepancy,
            });
        }
    }

    // Check for impossible altitudes
    const altitude = aircraft.alt_baro || aircraft.alt_geom;
    if (altitude < -1000 || altitude > 60000) {
        issues.push({ type: 'impossible', value: altitude });
    }

    // Check altitude source
    if (!aircraft.alt_baro && aircraft.alt_geom) {
        issues.push({ type: 'geometric_only' });
    }

    return {
        reliable: issues.length === 0,
        confidence: calculateConfidence(issues),
        issues,
        field: 'altitude',
        source: aircraft.alt_baro ? 'barometric' : 'geometric',
    };
}

function checkVelocityReliability(aircraft, _thresholds) {
    const issues = [];

    // Check if we have velocity data
    if (aircraft.gs === undefined || aircraft.track === undefined) {
        issues.push({ type: 'missing' });
        return { reliable: false, confidence: 0, issues, field: 'velocity' };
    }

    // Check for impossible speeds
    if (aircraft.gs < 0 || aircraft.gs > 2000) {
        issues.push({ type: 'impossible_speed', value: aircraft.gs });
    }

    // Check track validity
    if (aircraft.track < 0 || aircraft.track > 360) {
        issues.push({ type: 'invalid_track', value: aircraft.track });
    }

    // Check for impossible accelerations if we have history
    if (aircraft.track_rate !== undefined && Math.abs(aircraft.track_rate) > 30) {
        issues.push({ type: 'excessive_turn_rate', value: aircraft.track_rate });
    }

    return {
        reliable: issues.length === 0,
        confidence: calculateConfidence(issues),
        issues,
        field: 'velocity',
    };
}

function calculateConfidence(issues) {
    if (issues.length === 0) return 1;

    // Weight different issue types
    const weights = {
        missing: 0,
        stale: 0.5,
        discrepancy: 0.6,
        geometric_only: 0.8,
        low_integrity: 0.7,
        impossible: 0.1,
        invalid: 0.1,
    };

    let totalWeight = 0;
    issues.forEach((issue) => {
        const weight = weights[issue.type] || 0.5;
        totalWeight += 1 - weight;
    });

    return Math.max(0, 1 - totalWeight / issues.length);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Check reliability of data over a time period using historical data
 * @param {Array} dataPoints - Array of historical data points
 * @param {string} field - Field to analyze
 * @param {Object} options - Analysis options
 * @returns {Object} Reliability assessment over time
 */
function checkReliabilityOverTime(dataPoints, field, options = {}) {
    if (!dataPoints || dataPoints.length === 0) {
        return { reliable: false, reason: 'no data', confidence: 0 };
    }

    const results = dataPoints.map((point) => isReliable(point, field, options));
    const reliableCount = results.filter((r) => r.reliable).length;
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    // Look for consistency patterns
    const consistencyScore = calculateConsistency(dataPoints, field);

    return {
        reliable: reliableCount / dataPoints.length > 0.8,
        confidence: avgConfidence,
        reliableCount,
        totalCount: dataPoints.length,
        reliabilityRate: reliableCount / dataPoints.length,
        consistency: consistencyScore,
        details: results,
    };
}

function calculateConsistency(dataPoints, field) {
    if (dataPoints.length < 2) return 1;

    let consistencyScore = 1;

    switch (field) {
        case 'position':
            // Check for jumps in position
            for (let i = 1; i < dataPoints.length; i++) {
                const prev = dataPoints[i - 1];
                const curr = dataPoints[i];
                if (prev.lat && prev.lon && curr.lat && curr.lon) {
                    // Simple distance check - could use actual distance calculation
                    const latDiff = Math.abs(curr.lat - prev.lat);
                    const lonDiff = Math.abs(curr.lon - prev.lon);
                    if (latDiff > 0.1 || lonDiff > 0.1) {
                        // ~6-11km jump
                        consistencyScore *= 0.8;
                    }
                }
            }
            break;

        case 'altitude':
            // Check for unrealistic altitude changes
            for (let i = 1; i < dataPoints.length; i++) {
                const prev = dataPoints[i - 1];
                const curr = dataPoints[i];
                const prevAlt = prev.alt_baro || prev.alt_geom;
                const currAlt = curr.alt_baro || curr.alt_geom;
                if (prevAlt !== undefined && currAlt !== undefined) {
                    const altChange = Math.abs(currAlt - prevAlt);
                    const timeElapsed = (curr.seen || curr.now) - (prev.seen || prev.now);
                    const ratePerMin = (altChange / timeElapsed) * 60;
                    if (ratePerMin > 6000) {
                        // >6000 fpm is suspicious
                        consistencyScore *= 0.7;
                    }
                }
            }
            break;
    }

    return Math.max(0, consistencyScore);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

class AircraftData {
    constructor(aircraft, options = {}) {
        this.aircraft = aircraft;
        this.history = [];
        this.trajectoryData = aircraft.calculated?.trajectoryData || [];
        this.currentTimestamp = options.currentTimestamp || Date.now();
        this._cache = new Map();
    }

    static sortByDistance(a, b) {
        return (a.distance || 0) - (b.distance || 0);
    }

    static sortByAltitude(a, b) {
        return (b.altitude || 0) - (a.altitude || 0); // descending
    }

    static sortBySpeed(a, b) {
        return (b.speed || 0) - (a.speed || 0);
    }

    static sortByCallsign(a, b) {
        const callA = a.flight || a.hex || '',
            callB = b.flight || b.hex || '';
        return callA.localeCompare(callB);
    }

    static sortBySquawk(a, b) {
        return (a.squawk || '').localeCompare(b.squawk || '');
    }

    static sortByDistanceThenAltitude(a, b) {
        const distDiff = AircraftData.sortByDistance(a, b);
        return distDiff === 0 ? AircraftData.sortByAltitude(a, b) : distDiff;
    }

    static createSorter(...sortFunctions) {
        return (a, b) => {
            for (const sortFn of sortFunctions) {
                const result = sortFn(a, b);
                if (result !== 0) return result;
            }
            return 0;
        };
    }

    // Get arrays of specific fields from trajectory data
    getField(fieldPath, options = {}) {
        const cacheKey = `${fieldPath}-${JSON.stringify(options)}`;
        if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);

        const {
            includeCurrentValue = true,
            timeWindow = undefined, // milliseconds
            minDataPoints = 0,
            maxDataPoints = undefined,
        } = options;

        const values = [];
        const timestamps = [];

        // Filter by time window if specified
        const cutoffTime = timeWindow ? this.currentTimestamp - timeWindow : 0;

        // Extract from trajectory data
        this.trajectoryData.forEach((entry) => {
            if (timeWindow && entry.timestamp < cutoffTime) return;

            const value = this._getNestedValue(entry.snapshot, fieldPath);
            if (value !== undefined && value !== null) {
                values.push(value);
                timestamps.push(entry.timestamp);
            }
        });

        // Include current value if requested and different from last snapshot
        if (includeCurrentValue) {
            const currentValue = this._getNestedValue(this.aircraft, fieldPath);
            const lastSnapshot = this.trajectoryData[this.trajectoryData.length - 1]?.snapshot;
            const lastValue = lastSnapshot ? this._getNestedValue(lastSnapshot, fieldPath) : undefined;

            if (currentValue !== undefined && currentValue !== null && currentValue !== lastValue) {
                values.push(currentValue);
                timestamps.push(this.currentTimestamp);
            }
        }

        // Check if we have enough data points
        if (values.length < minDataPoints) {
            // Don't cache insufficient data
            return { values: [], timestamps: [] };
        }

        // Apply max data point limit if specified
        let result = { values, timestamps };
        if (maxDataPoints && values.length > maxDataPoints) {
            const start = values.length - maxDataPoints;
            result = {
                values: values.slice(start),
                timestamps: timestamps.slice(start),
            };
        }

        this._cache.set(cacheKey, result);
        return result;
    }

    // Get positions with additional metadata
    getPositions(options = {}) {
        const { includeCurrentValue, timeWindow, requireCompleteData = false } = options;

        const positions = [];
        const cutoffTime = timeWindow ? this.currentTimestamp - timeWindow : 0;

        this.trajectoryData.forEach((entry) => {
            if (timeWindow && entry.timestamp < cutoffTime) return;

            const { snapshot, timestamp } = entry;
            if (snapshot.lat !== undefined && snapshot.lon !== undefined) {
                const position = {
                    lat: snapshot.lat,
                    lon: snapshot.lon,
                    timestamp,
                };

                // Add optional fields if available
                if (snapshot.calculated?.altitude !== undefined) position.altitude = snapshot.calculated.altitude;
                if (snapshot.alt_baro !== undefined) position.alt_baro = snapshot.alt_baro;
                if (snapshot.track !== undefined) position.track = snapshot.track;
                if (snapshot.gs !== undefined) position.gs = snapshot.gs;
                if (snapshot.baro_rate !== undefined) position.baro_rate = snapshot.baro_rate;

                if (!requireCompleteData || (position.altitude !== undefined && position.track !== undefined)) {
                    positions.push(position);
                }
            }
        });

        // Include current position if different
        if (includeCurrentValue && this.aircraft.lat !== undefined && this.aircraft.lon !== undefined) {
            const lastPos = positions[positions.length - 1];
            if (!lastPos || lastPos.lat !== this.aircraft.lat || lastPos.lon !== this.aircraft.lon) {
                const currentPos = {
                    lat: this.aircraft.lat,
                    lon: this.aircraft.lon,
                    timestamp: this.currentTimestamp,
                };

                if (this.aircraft.calculated?.altitude !== undefined) currentPos.altitude = this.aircraft.calculated.altitude;
                if (this.aircraft.alt_baro !== undefined) currentPos.alt_baro = this.aircraft.alt_baro;
                if (this.aircraft.track !== undefined) currentPos.track = this.aircraft.track;
                if (this.aircraft.gs !== undefined) currentPos.gs = this.aircraft.gs;
                if (this.aircraft.baro_rate !== undefined) currentPos.baro_rate = this.aircraft.baro_rate;

                if (!requireCompleteData || (currentPos.altitude !== undefined && currentPos.track !== undefined)) {
                    positions.push(currentPos);
                }
            }
        }

        return positions;
    }

    // Statistical analysis methods
    getStats(fieldPath, options = {}) {
        const { values } = this.getField(fieldPath, options);
        if (values.length === 0) return undefined;

        const stats = {
            count: values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            first: values[0],
            last: values[values.length - 1],
        };

        // Calculate variance and standard deviation
        const variance = values.reduce((sum, val) => sum + (val - stats.avg) ** 2, 0) / values.length;
        stats.variance = variance;
        stats.stdDev = Math.sqrt(variance);

        // Calculate rate of change if we have timestamps
        const { timestamps } = this.getField(fieldPath, options);
        if (timestamps.length >= 2) {
            const timeDiff = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000; // seconds
            const valueDiff = values[values.length - 1] - values[0];
            stats.rateOfChange = timeDiff > 0 ? valueDiff / timeDiff : 0;
        }

        return stats;
    }

    // Pattern detection methods
    getDirectionChanges(fieldPath, threshold, options = {}) {
        const { values } = this.getField(fieldPath, options);
        if (values.length < 2) return { changes: 0, directions: [] };

        const changes = [];
        const directions = [];
        let lastDirection;

        for (let i = 1; i < values.length; i++) {
            const diff = values[i] - values[i - 1];
            if (Math.abs(diff) >= threshold) {
                const direction = diff > 0 ? 'up' : 'down';
                if (lastDirection && direction !== lastDirection) {
                    changes.push({ index: i, from: lastDirection, to: direction, value: values[i] });
                }
                directions.push(direction);
                lastDirection = direction;
            }
        }

        return {
            changes: changes.length,
            changeDetails: changes,
            directions,
        };
    }
    // Add to AircraftData class:

    // Get rate of change between consecutive values
    getRateOfChange(fieldPath, options = {}) {
        const { values, timestamps } = this.getField(fieldPath, options);
        if (values.length < 2) return [];

        const rates = [];
        for (let i = 1; i < values.length; i++) {
            const timeDiff = (timestamps[i] - timestamps[i - 1]) / 1000; // seconds
            const valueDiff = values[i] - values[i - 1];
            rates.push({
                rate: timeDiff > 0 ? valueDiff / timeDiff : 0,
                timestamp: timestamps[i],
                fromValue: values[i - 1],
                toValue: values[i],
            });
        }
        return rates;
    }

    // Detect if field is stable (low variance)
    isFieldStable(fieldPath, options = {}) {
        const { stdDevThreshold = 10, minDataPoints = 5, ...fieldOptions } = options;
        const stats = this.getStats(fieldPath, fieldOptions);

        if (!stats || stats.count < minDataPoints) return false;
        return stats.stdDev < stdDevThreshold;
    }

    // Get interpolated value at specific timestamp
    getInterpolatedValue(fieldPath, targetTimestamp) {
        const { values, timestamps } = this.getField(fieldPath);
        if (values.length === 0) return undefined;

        // Find surrounding points
        let before, after;
        // eslint-disable-next-line unicorn/no-for-loop
        for (let i = 0; i < timestamps.length; i++) {
            if (timestamps[i] <= targetTimestamp) {
                before = { value: values[i], timestamp: timestamps[i] };
            }
            if (timestamps[i] >= targetTimestamp && !after) {
                after = { value: values[i], timestamp: timestamps[i] };
                break;
            }
        }

        if (!before) return after?.value;
        if (!after) return before.value;
        if (before.timestamp === after.timestamp) return before.value;

        // Linear interpolation
        const ratio = (targetTimestamp - before.timestamp) / (after.timestamp - before.timestamp);
        return before.value + (after.value - before.value) * ratio;
    }

    // Check if aircraft is maneuvering
    isManeuvering(options = {}) {
        const {
            trackChangeThreshold = 5, // degrees
            altitudeChangeThreshold = 500, // feet
            speedChangeThreshold = 50, // knots
            timeWindow = 60000, // 1 minute
        } = options;

        const trackStats = this.getStats('track', { timeWindow });
        const altStats = this.getStats('calculated.altitude', { timeWindow });
        const speedStats = this.getStats('gs', { timeWindow });

        const trackChanging = trackStats && trackStats.max - trackStats.min > trackChangeThreshold;
        const altChanging = altStats && Math.abs(altStats.rateOfChange) > altitudeChangeThreshold / 60;
        const speedChanging = speedStats && speedStats.max - speedStats.min > speedChangeThreshold;

        return {
            maneuvering: trackChanging || altChanging || speedChanging,
            trackChange: trackStats ? trackStats.max - trackStats.min : 0,
            altitudeRate: altStats ? altStats.rateOfChange * 60 : 0, // ft/min
            speedChange: speedStats ? speedStats.max - speedStats.min : 0,
        };
    }

    // Get value from a specific time ago
    getValueAt(fieldPath, secondsAgo, toleranceSeconds = 5) {
        const targetTime = this.currentTimestamp - secondsAgo * 1000;
        const minTime = targetTime - toleranceSeconds * 1000;
        const maxTime = targetTime + toleranceSeconds * 1000;

        for (let i = this.trajectoryData.length - 1; i >= 0; i--) {
            const entry = this.trajectoryData[i];
            if (entry.timestamp >= minTime && entry.timestamp <= maxTime) {
                return this._getNestedValue(entry.snapshot, fieldPath);
            }
        }
        return undefined;
    }

    getDataInWindow(windowMs) {
        const cutoff = this.currentTimestamp - windowMs;
        return this.trajectoryData.filter((entry) => entry.timestamp >= cutoff);
    }

    // Check if data is sufficient for analysis
    hasMinimumData(minPoints = 3, timeWindow = undefined) {
        const cutoffTime = timeWindow ? this.currentTimestamp - timeWindow : 0;
        const validPoints = this.trajectoryData.filter((entry) => !timeWindow || entry.timestamp >= cutoffTime).length;
        return validPoints >= minPoints;
    }

    // Helper to get nested values using dot notation
    _getNestedValue(obj, path) {
        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }

        return current;
    }

    checkReliability(field, options = {}) {
        return isReliable(this.aircraft, field, options);
    }

    checkReliabilityOverTime(field, options = {}) {
        // Include current aircraft data with history
        const dataPoints = [...this.history, this.aircraft];
        return checkReliabilityOverTime(dataPoints, field, options);
    }

    getDataQuality() {
        const positionQuality = this.checkReliability('position');
        const altitudeQuality = this.checkReliability('altitude');
        const velocityQuality = this.checkReliability('velocity');

        const overallConfidence = (positionQuality.confidence + altitudeQuality.confidence + velocityQuality.confidence) / 3;

        return {
            overall: overallConfidence,
            position: positionQuality,
            altitude: altitudeQuality,
            velocity: velocityQuality,
            isReliable: overallConfidence > 0.7,
            issues: [...positionQuality.issues, ...altitudeQuality.issues, ...velocityQuality.issues],
        };
    }

    checkConsistency(timeWindow = 60) {
        const recentHistory = this.history.filter((point) => {
            const age = (this.aircraft.now || Date.now() / 1000) - (point.now || point.seen);
            return age <= timeWindow;
        });

        const results = {
            position: checkReliabilityOverTime(recentHistory, 'position'),
            altitude: checkReliabilityOverTime(recentHistory, 'altitude'),
            velocity: checkReliabilityOverTime(recentHistory, 'velocity'),
        };

        return {
            timeWindow,
            sampleCount: recentHistory.length,
            position: results.position,
            altitude: results.altitude,
            velocity: results.velocity,
            overallConsistency: (results.position.consistency + results.altitude.consistency + results.velocity.consistency) / 3,
        };
    }

    getReliabilityTrend(field) {
        return this.history.map((point, index) => {
            const reliability = isReliable(point, field);
            return {
                timestamp: point.now || point.seen,
                index,
                confidence: reliability.confidence,
                reliable: reliability.reliable,
                issues: reliability.issues.length,
            };
        });
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    AircraftData,

    // Data reliability
    isReliable,
    checkReliabilityOverTime,
    RELIABILITY_THRESHOLDS,

    // For testing
    checkPositionReliability,
    checkAltitudeReliability,
    checkVelocityReliability,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
