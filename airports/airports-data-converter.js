#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parse/sync');
const https = require('https');

const DATA_URLS = {
    'airports.csv': 'https://davidmegginson.github.io/ourairports-data/airports.csv',
    'runways.csv': 'https://davidmegginson.github.io/ourairports-data/runways.csv',
    'airport-frequencies.csv': 'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv',
};

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

function fetchFile(url) {
    return new Promise((resolve, reject) => {
        console.error(`Fetching from ${url}...`);
        https
            .get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                    return;
                }
                let data = '';
                response.on('data', (chunk) => (data += chunk));
                response.on('end', () => resolve(data));
                response.on('error', (err) => reject(err));
            })
            .on('error', (err) => reject(err));
    });
}

async function getFileContent(filename) {
    if (fs.existsSync(filename)) {
        console.error(`Reading local file: ${filename}`);
        return fs.readFileSync(filename, 'utf8');
    } else {
        console.error(`Local file not found: ${filename}`);
        if (DATA_URLS[filename]) {
            try {
                const content = await fetchFile(DATA_URLS[filename]);
                console.error(`Successfully fetched ${filename} from remote URL`);
                return content;
            } catch (e) {
                throw new Error(`Failed to fetch ${filename}: ${e.message}`);
            }
        } else {
            throw new Error(`No URL configured for ${filename}`);
        }
    }
}

function convertRow(row, mapping) {
    const converted = {};
    for (const [field, type] of Object.entries(mapping))
        if (row.hasOwnProperty(field)) {
            const validator = VALIDATORS[type];
            if (!validator) {
                console.error(`Unknown type ${type} for field ${field}`);
                converted[field] = row[field];
            } else converted[field] = validator(row[field]);
        }
    return converted;
}

async function readCSV(filename, mapping) {
    try {
        const fileContent = await getFileContent(filename);
        const records = csv.parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            relax_quotes: true,
            relax_column_count: true,
        });
        console.error(`Parsed ${filename}: ${records.length} records`);
        return records.map((row) => convertRow(row, mapping));
    } catch (error) {
        console.error(`Error processing ${filename}: ${error.message}`);
        return [];
    }
}

async function main() {
    try {
        const airports = await readCSV('airports.csv', TYPE_MAPPINGS.airports);

        const runways = await readCSV('runways.csv', TYPE_MAPPINGS.runways);
        const runwaysByAirport = {};
        runways.forEach((runway) => {
            const ident = runway.airport_ident;
            if (!runwaysByAirport[ident]) runwaysByAirport[ident] = [];
            runwaysByAirport[ident].push(runway);
        });

        const frequencies = await readCSV('airport-frequencies.csv', TYPE_MAPPINGS.frequencies);
        const frequenciesByAirport = {};
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

        console.error('\nProcessing complete:');
        console.error(`- Airports: ${Object.keys(masterStructure).length}`);
        console.error(`- Runways: ${runways.length}`);
        console.error(`- Frequencies: ${frequencies.length}`);
        let airportsWithRunways = 0,
            airportsWithFrequencies = 0;
        Object.values(masterStructure).forEach((airport) => {
            if (airport.runways.length > 0) airportsWithRunways++;
            if (airport.frequencies.length > 0) airportsWithFrequencies++;
        });
        console.error(`- Airports with runways: ${airportsWithRunways}`);
        console.error(`- Airports with frequencies: ${airportsWithFrequencies}`);

        const outputFile = 'airports-data.json';
        fs.writeFileSync(outputFile, JSON.stringify(masterStructure, null, 2));
        console.error(`\nOutput written to ${outputFile}`);
    } catch (e) {
        console.error('Fatal error:', e);
        process.exit(1);
    }
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log('Airport Data Converter');
    console.log('');
    console.log('Usage: node airports-data-converter.js [options]');
    console.log('');
    console.log('This script converts airport CSV data to JSON format.');
    console.log('It will use local CSV files if present, otherwise fetch from OurAirports.');
    console.log('');
    console.log('Output: airports-data.json');
    console.log('');
    console.log('Data sources:');
    Object.entries(DATA_URLS).forEach(([file, url]) => console.log(`  ${file}: ${url}`));
    process.exit(0);
}

main();
