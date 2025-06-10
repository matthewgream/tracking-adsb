// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculatePercentile(values, percentile) {
    if (!values || values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    return lower === upper ? sorted[lower] : sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function getOutlierType(val, lowerBound, upperBound) {
    if (val < lowerBound) return 'low';
    if (val > upperBound) return 'high';
    return 'normal';
}
function detectOutliers(values, method = 'iqr') {
    if (!values || values.length < 4) return [];
    if (method === 'iqr') {
        const q1 = calculatePercentile(values, 25);
        const q3 = calculatePercentile(values, 75);
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;
        return values
            .map((val, idx) => ({
                value: val,
                index: idx,
                isOutlier: val < lowerBound || val > upperBound,
                type: getOutlierType(val, lowerBound, upperBound),
            }))
            .filter((item) => item.isOutlier);
    }
    return undefined;
    // Add other methods (z-score, etc.) as needed
}

function filterByTimeWindow(items, timeField, windowMs, currentTime = Date.now()) {
    const cutoff = currentTime - windowMs;
    return items.filter((item) => {
        const timestamp = typeof timeField === 'function' ? timeField(item) : item[timeField];
        return timestamp >= cutoff;
    });
}

function findMatchingBand(value, bands, options = {}) {
    const { valueField = 'value', minField = 'min', maxField = 'max', inclusive = true } = options;
    return bands.find((band) => {
        const min = band[minField] ?? -Infinity;
        const max = band[maxField] ?? Infinity;
        const val = typeof value === 'object' ? value[valueField] : value;
        return inclusive ? val >= min && val <= max : val > min && val < max;
    });
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    calculatePercentile,
    detectOutliers,
    filterByTimeWindow,
    findMatchingBand,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
