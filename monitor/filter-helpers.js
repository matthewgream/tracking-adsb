// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function track2rad(track) {
    return deg2rad((450 - track) % 360);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1),
        dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const lat1Rad = (Math.PI * lat1) / 180,
        lat2Rad = (Math.PI * lat2) / 180;
    const lon1Rad = (Math.PI * lon1) / 180,
        lon2Rad = (Math.PI * lon2) / 180;
    const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad),
        x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
}

function calculateRelativePosition(refLat, refLon, targetLat, targetLon, track) {
    const distance = calculateDistance(refLat, refLon, targetLat, targetLon),
        bearing = calculateBearing(refLat, refLon, targetLat, targetLon);
    const relativeTrack = ((track - bearing + 180) % 360) - 180;
    return {
        distance,
        bearing,
        relativeTrack,
        cardinalBearing: bearing2Cardinal(bearing),
        approachingStation: Math.abs(relativeTrack) < 90,
    };
}

function bearing2Cardinal(bearing) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return directions[Math.round(bearing / 22.5) % 16];
}

module.exports = {
    deg2rad,
    track2rad,
    bearing2Cardinal,
    calculateDistance,
    calculateBearing,
    calculateRelativePosition,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
