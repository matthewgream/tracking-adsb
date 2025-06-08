#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parse/sync');

const TYPE_MAPPINGS = {
    airports: {
        id: 'integer',
        ident: 'string',
        type: 'string',
        name: 'string',
        latitude_deg: 'float',
        longitude_deg: 'float',
        elevation_ft: 'integer',
        continent: 'string',
        iso_country: 'string',
        iso_region: 'string',
        municipality: 'string',
        scheduled_service: 'string',
        icao_code: 'string',
        iata_code: 'string',
        gps_code: 'string',
        local_code: 'string',
        home_link: 'string',
        wikipedia_link: 'string',
        keywords: 'string',
    },
    runways: {
        id: 'integer',
        airport_ref: 'integer',
        airport_ident: 'string',
        length_ft: 'integer',
        width_ft: 'integer',
        surface: 'string',
        lighted: 'boolean',
        closed: 'boolean',
        le_ident: 'string',
        le_latitude_deg: 'float',
        le_longitude_deg: 'float',
        le_elevation_ft: 'integer',
        le_heading_degT: 'float',
        le_displaced_threshold_ft: 'integer',
        he_ident: 'string',
        he_latitude_deg: 'float',
        he_longitude_deg: 'float',
        he_elevation_ft: 'integer',
        he_heading_degT: 'float',
        he_displaced_threshold_ft: 'integer',
    },
    frequencies: {
        id: 'integer',
        airport_ref: 'integer',
        airport_ident: 'string',
        type: 'string',
        description: 'string',
        frequency_mhz: 'float',
    },
};

const VALIDATORS = {
    integer: (value) => {
        if (value === '' || value === null || value === undefined) return null;
        const num = parseInt(value, 10);
        if (isNaN(num)) {
            console.error(`Invalid integer value: ${value}`);
            return null;
        }
        return num;
    },
    float: (value) => {
        if (value === '' || value === null || value === undefined) return null;
        const num = parseFloat(value);
        if (isNaN(num)) {
            console.error(`Invalid float value: ${value}`);
            return null;
        }
        return num;
    },
    boolean: (value) => {
        if (value === '' || value === null || value === undefined) return null;
        if (value === '1' || value === 'true' || value === true) return true;
        if (value === '0' || value === 'false' || value === false) return false;
        console.error(`Invalid boolean value: ${value}`);
        return null;
    },
    string: (value) => {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    },
};

function convertRow(row, mapping) {
    const converted = {};
    for (const [field, type] of Object.entries(mapping)) {
        if (row.hasOwnProperty(field)) {
            const validator = VALIDATORS[type];
            if (!validator) {
                console.error(`Unknown type ${type} for field ${field}`);
                converted[field] = row[field];
            } else converted[field] = validator(row[field]);
        }
    }
    return converted;
}

function readCSV(filename, mapping) {
    try {
        const fileContent = fs.readFileSync(filename, 'utf8');
        const records = csv.parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            relax_quotes: true,
            relax_column_count: true,
        });
        console.error(`Reading ${filename}: ${records.length} records`);
        return records.map((row) => convertRow(row, mapping));
    } catch (error) {
        console.error(`Error reading ${filename}: ${error.message}`);
        return [];
    }
}

function main() {
    const airports = readCSV('airports.csv', TYPE_MAPPINGS.airports);
    const runways = readCSV('runways.csv', TYPE_MAPPINGS.runways);
    const frequencies = readCSV('airport-frequencies.csv', TYPE_MAPPINGS.frequencies);

    const runwaysByAirport = {};
    const frequenciesByAirport = {};

    runways.forEach((runway) => {
        const ident = runway.airport_ident;
        if (!runwaysByAirport[ident]) runwaysByAirport[ident] = [];
        runwaysByAirport[ident].push(runway);
    });

    frequencies.forEach((freq) => {
        const ident = freq.airport_ident;
        if (!frequenciesByAirport[ident]) frequenciesByAirport[ident] = [];
        frequenciesByAirport[ident].push(freq);
    });

    const masterStructure = {};
    airports.forEach((airport) => {
        const ident = airport.ident;
        masterStructure[ident] = {
            ...airport,
            runways: runwaysByAirport[ident] || [],
            frequencies: frequenciesByAirport[ident] || [],
        };
    });

    console.error('Processing complete:');
    console.error(`- Airports: ${Object.keys(masterStructure).length}`);
    console.error(`- Runways: ${runways.length}`);
    console.error(`- Frequencies: ${frequencies.length}`);
    let airportsWithRunways = 0;
    let airportsWithFrequencies = 0;
    Object.values(masterStructure).forEach((airport) => {
        if (airport.runways.length > 0) airportsWithRunways++;
        if (airport.frequencies.length > 0) airportsWithFrequencies++;
    });
    console.error(`- Airports with runways: ${airportsWithRunways}`);
    console.error(`- Airports with frequencies: ${airportsWithFrequencies}`);

    console.log(JSON.stringify(masterStructure, null, 2));
}

const requiredFiles = ['airports.csv', 'runways.csv', 'airport-frequencies.csv'];
const missingFiles = requiredFiles.filter((file) => !fs.existsSync(file));
if (missingFiles.length > 0) {
    console.error('Missing required files:', missingFiles.join(', '));
    console.error('Please ensure all CSV files are in the current directory.');
    console.error(' ... https://davidmegginson.github.io/ourairports-data/airports.csv');
    console.error(' ... https://davidmegginson.github.io/ourairports-data/runways.csv');
    console.error(' ... https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv');
    process.exit(1);
}
main();
