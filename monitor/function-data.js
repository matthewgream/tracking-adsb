// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Data Loader - Manages loading and caching of content files
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

class DataLoader {
    constructor(dataDirectory) {
        if (!dataDirectory) throw new Error('DataLoader: directory must be specified');
        this.dataDirectory = path.resolve(dataDirectory);
        this.cache = new Map();
        this.parsers = new Map();

        // Register default parsers
        this.registerParser('json', (data) => JSON.parse(data));
        this.registerParser('csv', (data) => this.parseCSV(data));
        // this.registerParser('dat', (data) => this.parseDAT(data));
        this.registerParser('txt', (data) => data.split('\n').filter((line) => line.trim()));
    }

    // Register a custom parser for a file extension
    registerParser(extension, parser) {
        this.parsers.set(extension.toLowerCase(), parser);
    }

    // Load a file from the content directory
    load(filename, options = {}) {
        const cacheKey = filename;

        // Check cache first
        if (!options.forceReload && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            // Ensure we're only loading from the content directory
            const filePath = path.resolve(this.dataDirectory, filename);
            if (!filePath.startsWith(this.dataDirectory)) {
                throw new Error(`Security: Cannot load files outside content directory`);
            }

            // Read the file
            const length = fs.statSync(filePath).size;
            const content = fs.readFileSync(filePath, 'utf8');

            // Parse based on extension or options
            let data, type;
            if (options.parser) {
                data = options.parser(content);
                type = 'custom';
            } else {
                const ext = path.extname(filename).slice(1).toLowerCase();
                const parser = this.parsers.get(ext);
                type = ext + (parser ? '' : ' (no parser)');
                data = parser ? parser(content) : content;
            }

            // Cache the result
            this.cache.set(cacheKey, data);

            return {
                info: `size=${Math.floor(length / 1024)}KB, type=${type}`,
                data,
            };
        } catch (e) {
            console.error(`Failed to load content file ${filename}:`, e.message);
            throw e;
        }
    }

    // Clear cache for a specific file or all files
    clearCache(filename = undefined) {
        if (filename) {
            this.cache.delete(filename);
        } else {
            this.cache.clear();
        }
    }

    // Check if a file exists
    exists(filename) {
        try {
            return fs.existsSync(path.resolve(this.dataDirectory, filename));
        } catch {
            return false;
        }
    }

    // Default CSV parser - can be enhanced with proper CSV library
    parseCSV(content) {
        return content
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => line.split(',').map((field) => field.trim()));
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports.DataLoader = DataLoader;

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
