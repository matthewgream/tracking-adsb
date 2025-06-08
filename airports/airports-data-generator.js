#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in kilometers
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function parseDistance(distanceStr) {
    const input = distanceStr.toString().toLowerCase().trim();
    const match = input.match(/^(\d+(?:\.\d+)?)\s*(nm|km)?$/);
    if (!match) throw new Error(`Invalid distance format: "${distanceStr}". Use format like "450nm", "750km", or "500" (default km)`);
    const value = parseFloat(match[1]);
    const unit = match[2] || 'km'; // Default to km if no unit specified
    let distanceKm = value;
    if (unit === 'nm') distanceKm = value * 1.852;
    return {
        value,
        unit,
        kilometers: distanceKm,
    };
}

function main() {
    const args = process.argv.slice(2);
    if (args.length !== 3) {
        console.log('Usage: ./airports-data-generator.js  latitude longitude distance');
        console.log('  latitude:  Decimal degrees (e.g., 40.7128)');
        console.log('  longitude: Decimal degrees (e.g., -74.0060)');
        console.log('  distance:  Radius with optional unit suffix');
        console.log('             Examples: "450nm", "750km", "500" (defaults to km)');
        console.log('\nExample: ./airports-data-generator.js 40.7128 -74.0060 450nm');
        process.exit(1);
    }
    const centerLat = parseFloat(args[0]),
        centerLon = parseFloat(args[1]);
    if (isNaN(centerLat) || isNaN(centerLon)) {
        console.error('Error: Invalid latitude or longitude values');
        process.exit(1);
    }
    if (Math.abs(centerLat) > 90) {
        console.error('Error: Latitude must be between -90 and 90 degrees');
        process.exit(1);
    }
    if (Math.abs(centerLon) > 180) {
        console.error('Error: Longitude must be between -180 and 180 degrees');
        process.exit(1);
    }
    let distance;
    try {
        distance = parseDistance(args[2]);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }

    console.log(`Searching for airports within ${distance.value}${distance.unit} (${distance.kilometers.toFixed(2)}km) of ${centerLat}, ${centerLon}`);
    let airports;
    try {
        airports = JSON.parse(fs.readFileSync('airports.json', 'utf8'));
    } catch (err) {
        console.error('Error reading airports.json:', err.message);
        process.exit(1);
    }

    const result = {};
    let totalAirports = 0,
        foundAirports = 0;
    for (const [code, airport] of Object.entries(airports)) {
        totalAirports++;
        try {
            const lat = parseFloat(airport.latitude_deg),
                lon = parseFloat(airport.longitude_deg);
            if (isNaN(lat) || isNaN(lon)) continue;
            const distanceKm = haversine(centerLat, centerLon, lat, lon);
            if (distanceKm <= distance.kilometers) {
                result[code] = {
                    ...airport,
                    distance_km: Math.round(distanceKm * 10) / 10,
                    distance_nm: Math.round((distanceKm / 1.852) * 10) / 10,
                };
                foundAirports++;
            }
        } catch (err) {
            continue;
        }
    }
    console.log(`Found ${foundAirports} airports out of ${totalAirports} total airports`);
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
