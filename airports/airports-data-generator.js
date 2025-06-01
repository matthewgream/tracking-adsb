#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in kilometers
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function main() {
    const args = process.argv.slice(2);

    if (args.length !== 3) {
        console.log('Usage: node script.js latitude longitude distance_km');
        process.exit(1);
    }

    const centerLat = parseFloat(args[0]),
        centerLon = parseFloat(args[1]),
        radiusKm = parseFloat(args[2]);

    let airports;
    try {
        airports = JSON.parse(fs.readFileSync('airports.json', 'utf8'));
    } catch (err) {
        console.error('Error reading airports.json:', err.message);
        process.exit(1);
    }

    const result = {};
    for (const [code, airport] of Object.entries(airports)) {
        try {
            const lat = parseFloat(airport.lat),
                lon = parseFloat(airport.lon);
            if (isNaN(lat) || isNaN(lon)) continue;
            const distance = haversine(centerLat, centerLon, lat, lon);
            if (distance <= radiusKm) result[code] = airport;
        } catch (err) {
            continue;
        }
    }

    const outputFile = `airports-data.${os.hostname()}.js`;
    const outputContent = `const airportsData = ${JSON.stringify(result, null, 4)};
module.exports = airportsData;
`;
    try {
        fs.writeFileSync(outputFile, outputContent);
        console.log(`Output written to ${outputFile}`);
    } catch (err) {
        console.error('Error writing output file:', err.message);
        process.exit(1);
    }
}

main();
