// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const DEFAULT_TYPE_PRIORITIES = {
    emergency: 1,
    sar: 1,
    hems: 2,
    police: 2,
    royal: 2,
    government: 3,
    military: 3,
    special: 4,
    danger_area: 4,
    display: 5,
    helicopter: 6,
    monitoring: 7,
    conspicuity: 8,
    approach: 9,
    tower: 9,
    radar: 9,
    fis: 10,
    service: 10,
    training: 10,
    uas: 10,
    ifr: 11,
    domestic: 11,
    transit: 12,
    offshore: 12,
    assigned: 13,
    ground: 14,
};

const DEFAULT_CODE_PRIORITIES = {
    7500: 1, // Hijacking
    7600: 1, // Radio failure
    7700: 1, // Emergency
    '0023': 2, // SAR operations
    '0020': 2, // HEMS
    '0030': 3, // FIR Lost
    '0032': 3, // Police operations
    '0037': 3, // Royal flights
    7001: 4, // Military low level
    7002: 5, // Danger areas
    7003: 5, // Red Arrows
    7004: 5, // Aerobatics
    7400: 3, // UAS Lost Link
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectGroundTestingMismatch(tools, aircraft, squawkMatches) {
    // Check if using ground testing code (0002) while airborne
    const groundTestingMatch = squawkMatches.find((match) => match.begin === '0002');
    if (groundTestingMatch && aircraft.calculated?.altitude > 500)
        return {
            type: 'ground-testing-airborne',
            severity: 'high',
            details: `Using ground testing code 0002 at ${aircraft.calculated.altitude} ft`,
            description: 'Ground transponder testing code used while airborne',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectMilitarySquawkMismatch(tools, aircraft, squawkMatches) {
    // Check if using military squawk without military flight prefix
    const militarySquawk = squawkMatches.find(
        (match) => match.type === 'military' || (match.description && match.description.some((desc) => desc.toLowerCase().includes('military')))
    );
    if (militarySquawk && !aircraft.calculated?.is_military)
        return {
            type: 'military-squawk-civilian',
            severity: 'medium',
            details: `Military squawk ${aircraft.squawk} on apparent civilian flight`,
            description: 'Military transponder code on non-military callsign',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAltitudeMismatch(tools, aircraft, _squawkMatches) {
    // Check VFR conspicuity (7000) above transition level
    if (aircraft.squawk === '7000' && aircraft.calculated?.altitude > 20000)
        return {
            type: 'vfr-high-altitude',
            severity: 'medium',
            details: `VFR conspicuity code at FL${Math.round(aircraft.calculated.altitude / 100)}`,
            description: 'VFR code at IFR altitude',
        };
    // Check IFR conspicuity (2000) at very low altitude
    if (aircraft.squawk === '2000' && aircraft.calculated?.altitude < 1000 && aircraft.calculated?.altitude > 0)
        return {
            type: 'ifr-low-altitude',
            severity: 'low',
            details: `IFR conspicuity code at ${aircraft.calculated.altitude} ft`,
            description: 'IFR code at very low altitude',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectInappropriateSpecialUseCode(tools, aircraft, squawkMatches) {
    // Check for special purpose codes that seem inappropriate
    const specialMatches = squawkMatches.filter((match) => match.type === 'special' || match.type === 'royal' || match.type === 'display');
    for (const match of specialMatches) {
        // Red Arrows code on slow aircraft
        if (match.begin === '7003' && aircraft.gs && aircraft.gs < 200)
            return {
                type: 'display-code-slow-aircraft',
                severity: 'medium',
                details: `Red Arrows display code at ${aircraft.gs} kts`,
                description: 'Display team code on slow aircraft',
            };
        // Royal flight code on high-altitude aircraft (royal flights typically lower)
        if (match.type === 'royal' && aircraft.calculated?.altitude > 30000)
            return {
                type: 'royal-code-high-altitude',
                severity: 'low',
                details: `Royal flight code at FL${Math.round(aircraft.calculated.altitude / 100)}`,
                description: 'Royal flight code at unusually high altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectModeSTesting(tools, aircraft, squawkMatches) {
    // Check if using SSR monitor codes (7776-7777) on an actual aircraft
    const monitorMatch = squawkMatches.find((match) => match.begin === '7776' || match.begin === '7777');
    if (monitorMatch && aircraft.gs > 0)
        return {
            type: 'ssr-monitor-code-moving',
            severity: 'high',
            details: `Using SSR monitor code ${aircraft.squawk} while moving at ${aircraft.gs} kts`,
            description: 'Far Field Monitor code on moving aircraft',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectModeS1000Misuse(tools, aircraft, squawkMatches) {
    // Check if using code 1000 (IFR GAT with validated Mode S)
    const mode1000Match = squawkMatches.find((match) => match.begin === '1000');
    if (mode1000Match) {
        // If no flight ID or appears to be VFR
        if (!aircraft.flight || aircraft.flight === '[' + aircraft.hex + ']')
            return {
                type: 'mode-s-1000-no-flight-id',
                severity: 'medium',
                details: `Using Mode S code 1000 without proper flight identification`,
                description: 'IFR Mode S code without validated flight ID',
            };
        // Check if flying VFR altitudes with IFR code
        if (aircraft.alt_baro && aircraft.alt_baro < 10000 && aircraft.alt_baro % 500 !== 0)
            return {
                type: 'mode-s-1000-vfr-altitude',
                severity: 'low',
                details: `IFR code 1000 at VFR altitude ${aircraft.alt_baro} ft`,
                description: 'IFR Mode S code at VFR altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAerobaticsCodeMisuse(tools, aircraft, squawkMatches) {
    // Check for aerobatics code (7004) usage
    const aeroMatch = squawkMatches.find((match) => match.begin === '7004');
    if (aeroMatch) {
        // Check if aircraft is in straight and level flight
        if (aircraft.roll !== undefined && Math.abs(aircraft.roll) < 5 && aircraft.baro_rate !== undefined && Math.abs(aircraft.baro_rate) < 500)
            return {
                type: 'aerobatics-code-level-flight',
                severity: 'medium',
                details: `Aerobatics code 7004 in level flight (roll: ${aircraft.roll}°, climb: ${aircraft.baro_rate} fpm)`,
                description: 'Display code in normal flight',
            };
        // Check if too high for aerobatics
        if (aircraft.alt_baro > 20000)
            return {
                type: 'aerobatics-code-high-altitude',
                severity: 'high',
                details: `Aerobatics code at FL${Math.round(aircraft.alt_baro / 100)}`,
                description: 'Display code above normal aerobatic altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectHighEnergyManeuversCode(tools, aircraft, squawkMatches) {
    // Check for high-energy maneuvers code (7005)
    const hemMatch = squawkMatches.find((match) => match.begin === '7005');
    if (hemMatch) {
        // Check if aircraft is slow (not a fast jet)
        if (aircraft.gs < 250)
            return {
                type: 'high-energy-code-slow-aircraft',
                severity: 'medium',
                details: `High-energy maneuvers code 7005 at ${aircraft.gs} kts`,
                description: 'Fast jet code on slow aircraft',
            };
        // Check if above FL195 (code only valid below)
        if (aircraft.alt_baro > 19500)
            return {
                type: 'high-energy-code-high-altitude',
                severity: 'high',
                details: `Code 7005 at FL${Math.round(aircraft.alt_baro / 100)} (only valid below FL195)`,
                description: 'High-energy code above authorized altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectMonitoringCodeAnomalies(tools, aircraft, squawkMatches) {
    // Check if using a frequency monitoring code
    const monitoringMatch = squawkMatches.find((match) => match.type === 'monitoring');
    if (monitoringMatch) {
        // Check if aircraft is too far from the relevant area
        // This is simplified - ideally would check actual distance from airport
        if (aircraft.alt_baro > 15000)
            return {
                type: 'monitoring-code-high-altitude',
                severity: 'low',
                details: `Frequency monitoring code ${aircraft.squawk} at FL${Math.round(aircraft.alt_baro / 100)}`,
                description: 'Airport monitoring code at high altitude',
            };
        // Check if moving too fast for pattern work
        if (aircraft.gs > 250)
            return {
                type: 'monitoring-code-high-speed',
                severity: 'medium',
                details: `Monitoring code at ${aircraft.gs} kts`,
                description: 'Frequency monitoring code at high speed',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectConspicuityConflicts(tools, aircraft, squawkMatches) {
    // Check for specific conspicuity codes with restrictions
    const conspicuityMatch = squawkMatches.find((match) => match.type === 'conspicuity');
    if (conspicuityMatch) {
        // Check for VFR conspicuity (7000) in IMC conditions
        if (aircraft.squawk === '7000' && aircraft.nav_modes && aircraft.nav_modes.includes('vnav'))
            return {
                type: 'vfr-conspicuity-ifr-equipment',
                severity: 'medium',
                details: `VFR code 7000 with IFR navigation modes active`,
                description: 'VFR conspicuity with IFR operations',
            };
        // Check for IFR conspicuity (2000) with VFR-like behavior
        if (aircraft.squawk === '2000' && aircraft.alt_baro < 3000 && aircraft.gs < 100)
            return {
                type: 'ifr-conspicuity-low-slow',
                severity: 'low',
                details: `IFR code 2000 at ${aircraft.alt_baro} ft and ${aircraft.gs} kts`,
                description: 'IFR conspicuity in VFR-like conditions',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectUASAnomalies(tools, aircraft, squawkMatches) {
    // Check for UAS codes
    const uasMatch = squawkMatches.find((match) => match.type === 'uas');
    if (uasMatch) {
        // Check for lost link code (7400) with normal operations
        // If still maneuvering normally, might not actually be lost link
        if (aircraft.squawk === '7400' && aircraft.track_rate && Math.abs(aircraft.track_rate) > 3)
            return {
                type: 'uas-lost-link-maneuvering',
                severity: 'high',
                details: `Lost link code 7400 but maneuvering at ${aircraft.track_rate}°/s`,
                description: 'UAS lost link code with active maneuvering',
            };
        // Check for BVLOS trial code (6000) outside segregated airspace
        if (aircraft.squawk === '6000' && aircraft.alt_baro > 5000)
            return {
                type: 'uas-bvlos-high-altitude',
                severity: 'high',
                details: `BVLOS trial code at ${aircraft.alt_baro} ft`,
                description: 'UAS trial code at unexpected altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectEmergencySquawkWithoutEmergency(tools, aircraft, squawkMatches) {
    const emergencySquawk = squawkMatches.find((match) => match.type === 'emergency' || ['7500', '7600', '7700'].includes(match.begin));
    if (emergencySquawk) {
        // Check emergency flag mismatch
        if (!aircraft.emergency || aircraft.emergency === 'none')
            return {
                type: 'emergency-squawk-no-flag',
                severity: 'high',
                details: `Emergency squawk ${aircraft.squawk} without emergency status`,
                description: 'Emergency code without corresponding emergency flag',
            };
        // Check for radio failure (7600) with changing heading
        if (aircraft.squawk === '7600' && aircraft.nav_heading && aircraft.true_heading && Math.abs(aircraft.nav_heading - aircraft.true_heading) > 30)
            return {
                type: 'radio-failure-heading-changes',
                severity: 'medium',
                details: `Radio failure code but heading changes detected`,
                description: 'NORDO code with active navigation',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectOffshoreCodeMisuse(tools, aircraft, squawkMatches) {
    const offshoreMatch = squawkMatches.find((match) => match.type === 'offshore');
    if (offshoreMatch) {
        // Check if aircraft is over land (simplified check)
        if (aircraft.alt_baro > 10000)
            return {
                type: 'offshore-code-high-altitude',
                severity: 'medium',
                details: `Offshore code ${aircraft.squawk} at FL${Math.round(aircraft.alt_baro / 100)}`,
                description: 'Offshore operations code at high altitude',
            };
        // Check if moving too fast for helicopter ops
        if (aircraft.gs > 200)
            return {
                type: 'offshore-code-high-speed',
                severity: 'medium',
                details: `Offshore code at ${aircraft.gs} kts`,
                description: 'Helicopter ops code on fast aircraft',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectMilitaryLowLevelMisuse(tools, aircraft, squawkMatches) {
    // Check for military low level code (7001)
    const lowLevelMatch = squawkMatches.find((match) => match.begin === '7001');
    if (lowLevelMatch) {
        // Should be below 2000ft MSD for entry
        if (aircraft.alt_baro > 5000)
            return {
                type: 'military-low-level-high',
                severity: 'medium',
                details: `Military low level code at ${aircraft.alt_baro} ft`,
                description: 'Low flying code above LFS altitude',
            };
        // Check if it's actually a military aircraft
        if (!aircraft.calculated?.is_military && aircraft.gs < 200)
            return {
                type: 'military-low-level-civilian',
                severity: 'high',
                details: `Military code 7001 on apparent civilian aircraft`,
                description: 'Military LFS code on non-military aircraft',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectHelicopterCodeMismatch(tools, aircraft, squawkMatches) {
    const heliMatch = squawkMatches.find(
        (match) =>
            match.type === 'helicopter' ||
            (match.description &&
                match.description.some(
                    (desc) => desc.toLowerCase().includes('helicopter') || desc.toLowerCase().includes('rotary') || desc.toLowerCase().includes('hems')
                ))
    );
    if (heliMatch && aircraft.category && aircraft.category !== 'A7') {
        // Special case: HEMS codes might be on fixed-wing air ambulances
        if (heliMatch.description?.some((desc) => desc.includes('HEMS')) && ['A1', 'A2'].includes(aircraft.category)) return undefined; // Small fixed-wing air ambulance is ok
        return {
            type: 'helicopter-code-fixed-wing',
            severity: 'high',
            details: `Helicopter code ${aircraft.squawk} on ${tools.formatCategoryCode(aircraft.category) || 'non-rotorcraft'}`,
            description: 'Rotorcraft code on fixed-wing aircraft',
        };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectLightAircraftCodeMismatch(tools, aircraft, squawkMatches) {
    // Check for glider towing codes
    const gliderMatch = squawkMatches.find((match) =>
        match.description?.some((desc) => desc.toLowerCase().includes('glider') || desc.toLowerCase().includes('towing'))
    );
    if (gliderMatch) {
        // Glider towing should be light aircraft or gliders
        if (aircraft.category && !['A1', 'B1', 'B4'].includes(aircraft.category))
            return {
                type: 'glider-ops-wrong-category',
                severity: 'medium',
                details: `Glider ops code ${aircraft.squawk} on ${tools.formatCategoryCode(aircraft.category)}`,
                description: 'Glider operations code on inappropriate aircraft',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectSurfaceVehicleCodeAirborne(tools, aircraft, squawkMatches) {
    // Check if it's a surface vehicle category
    if (aircraft.category && ['C1', 'C2'].includes(aircraft.category)) {
        // Surface vehicles shouldn't be at altitude or have significant ground speed
        if (aircraft.alt_baro > 100 || aircraft.gs > 80)
            return {
                type: 'surface-vehicle-airborne',
                severity: 'high',
                details: `Surface vehicle category ${aircraft.category} at ${aircraft.alt_baro} ft / ${aircraft.gs} kts`,
                description: 'Surface vehicle category appears airborne',
            };
    }
    // Also check for ground testing code on airborne
    const groundMatch = squawkMatches.find((match) => match.type === 'ground');
    if (groundMatch && aircraft.category && aircraft.category.startsWith('A')) {
        if (aircraft.gs > 50)
            return {
                type: 'ground-code-moving-aircraft',
                severity: 'high',
                details: `Ground code ${aircraft.squawk} on moving aircraft at ${aircraft.gs} kts`,
                description: 'Ground equipment code on moving aircraft',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectUAVCategoryAnomalies(tools, aircraft, squawkMatches) {
    if (aircraft.category === 'B6') {
        // UAV/Drone
        // Check if using manned aircraft codes
        const mannedCodes = squawkMatches.find(
            (match) =>
                ['military', 'royal', 'police', 'hems'].includes(match.type) &&
                !match.description?.some((desc) => desc.toLowerCase().includes('uas') || desc.toLowerCase().includes('unmanned'))
        );
        if (mannedCodes)
            return {
                type: 'uav-manned-aircraft-code',
                severity: 'medium',
                details: `UAV using manned aircraft code ${aircraft.squawk}`,
                description: 'Drone with manned aircraft transponder code',
            };
        // UAVs shouldn't use VFR conspicuity
        if (aircraft.squawk === '7000')
            return {
                type: 'uav-vfr-conspicuity',
                severity: 'high',
                details: `UAV using VFR conspicuity code`,
                description: 'Unmanned aircraft on VFR code',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAircraftSizeMismatch(tools, aircraft, squawkMatches) {
    // Check for light aircraft specific codes
    const lightMatch = squawkMatches.find((match) =>
        match.description?.some(
            (desc) => desc.toLowerCase().includes('light aircraft') || desc.toLowerCase().includes('microlight') || desc.toLowerCase().includes('ultralight')
        )
    );
    if (lightMatch && aircraft.category && ['A3', 'A4', 'A5'].includes(aircraft.category))
        return {
            type: 'heavy-aircraft-light-code',
            severity: 'medium',
            details: `${tools.formatCategoryCode(aircraft.category)} using light aircraft code ${aircraft.squawk}`,
            description: 'Large aircraft using light aircraft code',
        };
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectParachutingCodeValidation(tools, aircraft, squawkMatches) {
    const paraMatch = squawkMatches.find((match) => match.begin === '0033'); // Paradropping code
    if (paraMatch) {
        // Parachuting aircraft should be appropriate category
        if (aircraft.category && ['A4', 'A5'].includes(aircraft.category))
            return {
                type: 'paradrop-heavy-aircraft',
                severity: 'low',
                details: `Heavy aircraft ${tools.formatCategoryCode(aircraft.category)} using paradrop code`,
                description: 'Unusually large aircraft for parachuting ops',
            };
        // Should be at appropriate altitude for drops
        if (aircraft.alt_baro && (aircraft.alt_baro < 3000 || aircraft.alt_baro > 20000))
            return {
                type: 'paradrop-altitude-unusual',
                severity: 'medium',
                details: `Paradrop code at ${aircraft.alt_baro} ft`,
                description: 'Parachuting code at unusual altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectDescriptionBasedAnomalies(tools, aircraft, squawkMatches) {
    const anomalies = [];

    squawkMatches.forEach((match) => {
        if (!match.description) return;
        match.description.forEach((desc) => {
            const lowerDesc = desc.toLowerCase();
            // Check for "shall only be selected with ATC direction"
            if (lowerDesc.includes('shall only be selected with atc direction') || lowerDesc.includes('only be selected with atc direction')) {
                // These codes shouldn't be used casually
                if (aircraft.category && ['B1', 'B4'].includes(aircraft.category))
                    anomalies.push({
                        type: 'atc-directed-code-light-aircraft',
                        severity: 'medium',
                        details: `ATC-directed code ${aircraft.squawk} on ${tools.formatCategoryCode(aircraft.category)}`,
                        description: 'Restricted code on recreational aircraft',
                    });
            }
            // Check for distance restrictions (e.g., "within 20 NM")
            const distanceMatch = lowerDesc.match(/within (\d+) nm/i);
            if (distanceMatch && aircraft.gs > 250)
                anomalies.push({
                    type: 'local-code-high-speed',
                    severity: 'low',
                    details: `Local area code ${aircraft.squawk} at ${aircraft.gs} kts`,
                    description: 'Distance-restricted code on fast aircraft',
                });
            // Check for altitude restrictions
            const altMatch = lowerDesc.match(/(?:below|under) (?:fl\s*)?(\d+)/i);
            if (altMatch) {
                const maxAlt = Number.parseInt(altMatch[1]) * (altMatch[0].includes('fl') ? 100 : 1);
                if (aircraft.alt_baro > maxAlt)
                    anomalies.push({
                        type: 'altitude-restricted-code',
                        severity: 'high',
                        details: `Code ${aircraft.squawk} above ${maxAlt} ft restriction`,
                        description: 'Altitude-restricted code exceeded',
                    });
            }
            // Check for specific aircraft type requirements
            if (lowerDesc.includes('helicopter') && aircraft.category !== 'A7')
                anomalies.push({
                    type: 'helicopter-only-code',
                    severity: 'high',
                    details: `Helicopter-only code on ${tools.formatCategoryCode(aircraft.category)}`,
                    description: 'Rotorcraft-specific code misuse',
                });
            // Check for "conspicuity" codes being used with discrete services
            if (lowerDesc.includes('conspicuity') && aircraft.flight && !aircraft.flight.includes('[')) {
                // Has a proper callsign, might be receiving service
                if (['approach', 'tower', 'radar'].some((service) => squawkMatches.some((m) => m.type === service)))
                    anomalies.push({
                        type: 'conspicuity-with-service',
                        severity: 'low',
                        details: `Conspicuity code ${aircraft.squawk} with apparent ATC service`,
                        description: 'Conspicuity code possibly receiving service',
                    });
            }
        });
    });

    return anomalies.length > 0 ? anomalies[0] : undefined; // Return most relevant
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectSAROperationsValidation(tools, aircraft, squawkMatches) {
    const sarMatch = squawkMatches.find((match) => match.begin === '0023'); // SAR operations
    if (sarMatch) {
        // SAR aircraft should be appropriate types
        if (aircraft.category && ['B1', 'B4', 'C1', 'C2'].includes(aircraft.category))
            return {
                type: 'sar-inappropriate-category',
                severity: 'high',
                details: `SAR code on ${tools.formatCategoryCode(aircraft.category)}`,
                description: 'Search and rescue code on inappropriate vehicle',
            };
        // SAR operations typically at lower altitudes
        if (aircraft.alt_baro > 15000)
            return {
                type: 'sar-high-altitude',
                severity: 'medium',
                details: `SAR operations at FL${Math.round(aircraft.alt_baro / 100)}`,
                description: 'Search and rescue code at cruise altitude',
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectTrainingCodeValidation(tools, aircraft, squawkMatches) {
    // Check for student pilot codes (e.g., 5067 for Liverpool students)
    const studentMatch = squawkMatches.find((match) => match.description?.some((desc) => desc.toLowerCase().includes('student')));
    if (studentMatch) {
        // Students typically in light aircraft
        if (aircraft.category && !['A1', 'A2', 'B1'].includes(aircraft.category))
            return {
                type: 'student-large-aircraft',
                severity: 'medium',
                details: `Student pilot code on ${tools.formatCategoryCode(aircraft.category)}`,
                description: 'Training code on large aircraft',
            };
        // Students shouldn't be at high altitude
        if (aircraft.alt_baro > 10000)
            return {
                type: 'student-high-altitude',
                severity: 'medium',
                details: `Student code at FL${Math.round(aircraft.alt_baro / 100)}`,
                description: 'Training code above typical training altitude',
            };
    }
    return undefined;
}
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const severityRank = { high: 3, medium: 2, low: 1 };

module.exports = {
    id: 'squawks',
    name: 'Squawk code analysis',
    priority: 3,
    config: (conf, extra) => {
        this.conf = conf || {};
        this.extra = extra;
        this.squawkData = extra.data?.squawks;
        if (this.squawkData === undefined) console.error('filter-squawks: squawk data not available');
        this.typePriorities = this.conf.typePriorities || DEFAULT_TYPE_PRIORITIES;
        this.codePriorities = this.conf.codePriorities || DEFAULT_CODE_PRIORITIES;
        this.watchCodes = new Set(this.conf.watchCodes || Object.keys(DEFAULT_CODE_PRIORITIES));
        this.watchTypes = new Set(this.conf.watchTypes || ['emergency', 'sar', 'hems', 'police', 'royal', 'military', 'special']);
        this.detectAnomalies = this.conf.detectAnomalies !== false; // Default true
    },
    preprocess: (aircraft) => {
        aircraft.calculated.squawk = { code: aircraft.squawk, matches: [], isInteresting: false, anomalies: [] };
        if (aircraft.squawk === undefined || !this.squawkData) return;

        const matches = this.squawkData.findByCode(aircraft.squawk);
        aircraft.calculated.squawk.matches = matches;

        const isWatchedCode = this.watchCodes.has(aircraft.squawk);
        const hasWatchedType = matches.some((match) => this.watchTypes.has(match.type));
        aircraft.calculated.squawk.isInteresting = isWatchedCode || hasWatchedType;

        if (this.detectAnomalies && matches.length > 0) {
            const anomalies = [
                detectGroundTestingMismatch(this.extra, aircraft, matches),
                detectMilitarySquawkMismatch(this.extra, aircraft, matches),
                detectAltitudeMismatch(this.extra, aircraft, matches),
                detectInappropriateSpecialUseCode(this.extra, aircraft, matches),
                detectModeSTesting(this.extra, aircraft, matches),
                detectModeS1000Misuse(this.extra, aircraft, matches),
                detectAerobaticsCodeMisuse(this.extra, aircraft, matches),
                detectHighEnergyManeuversCode(this.extra, aircraft, matches),
                detectMonitoringCodeAnomalies(this.extra, aircraft, matches),
                detectConspicuityConflicts(this.extra, aircraft, matches),
                detectUASAnomalies(this.extra, aircraft, matches),
                detectEmergencySquawkWithoutEmergency(this.extra, aircraft, matches),
                detectOffshoreCodeMisuse(this.extra, aircraft, matches),
                detectMilitaryLowLevelMisuse(this.extra, aircraft, matches),
                detectHelicopterCodeMismatch(this.extra, aircraft, matches),
                detectLightAircraftCodeMismatch(this.extra, aircraft, matches),
                detectSurfaceVehicleCodeAirborne(this.extra, aircraft, matches),
                detectUAVCategoryAnomalies(this.extra, aircraft, matches),
                detectAircraftSizeMismatch(this.extra, aircraft, matches),
                detectParachutingCodeValidation(this.extra, aircraft, matches),
                detectDescriptionBasedAnomalies(this.extra, aircraft, matches),
                detectSAROperationsValidation(this.extra, aircraft, matches),
                detectTrainingCodeValidation(this.extra, aircraft, matches),
            ].filter(Boolean);
            if (anomalies.length > 0) {
                aircraft.calculated.squawk.anomalies = anomalies;
                aircraft.calculated.squawk.highestSeverity = anomalies.reduce(
                    (highest, current) => (severityRank[current.severity] > severityRank[highest] ? current.severity : highest),
                    'low'
                );
            }
        }
    },
    evaluate: (aircraft) => aircraft.calculated.squawk.isInteresting || aircraft.calculated.squawk.anomalies.length > 0,
    sort: (a, b) => {
        const a_ = a.calculated.squawk,
            b_ = b.calculated.squawk;
        if (a_.anomalies.length > 0 || b_.anomalies.length > 0) {
            const aSeverity = severityRank[a_.highestSeverity] ?? 0,
                bSeverity = severityRank[b_.highestSeverity] ?? 0;
            if (aSeverity !== bSeverity) return bSeverity - aSeverity;
        }
        const aCodePriority = this.codePriorities[a_.code] ?? Infinity,
            bCodePriority = this.codePriorities[b_.code] ?? Infinity;
        if (aCodePriority !== bCodePriority) return aCodePriority - bCodePriority;
        const aTypePriority = Math.min(...a_.matches.map((m) => this.typePriorities[m.type] ?? Infinity)),
            bTypePriority = Math.min(...b_.matches.map((m) => this.typePriorities[m.type] ?? Infinity));
        if (aTypePriority !== bTypePriority) return aTypePriority - bTypePriority;
        return helpers.sortDistance(a, b);
    },
    getStats: (aircrafts, list) => {
        const byType = list
            .flatMap((a) => a.calculated.squawk.matches.map((m) => m.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        const byCode = list.map((a) => a.calculated.squawk.code).reduce((counts, code) => ({ ...counts, [code]: (counts[code] || 0) + 1 }), {});
        const withAnomalies = list.filter((a) => a.calculated.squawk.anomalies.length > 0);
        const anomalyTypes = withAnomalies
            .flatMap((a) => a.calculated.squawk.anomalies.map((an) => an.type))
            .reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {});
        return {
            total: list.length,
            byType,
            byCode,
            anomalyCount: withAnomalies.length,
            anomalyTypes,
        };
    },
    format: (aircraft) => {
        const { squawk } = aircraft.calculated;
        if (squawk.anomalies.length > 0) {
            const [primary] = squawk.anomalies,
                count = squawk.anomalies.length;
            const suffix = count > 1 ? ` (+${count - 1} more)` : '';
            return {
                text: `squawk ${squawk.code} anomaly: ${primary.description}${suffix}`,
                warn: squawk.highestSeverity === 'high',
                squawkInfo: {
                    code: squawk.code,
                    anomalies: squawk.anomalies,
                    matches: squawk.matches,
                },
            };
        }
        if (squawk.matches.length > 0) {
            const [primary] = squawk.matches,
                count = squawk.matches.length;
            const suffix = count > 1 ? ` (+${count - 1} more)` : '';
            const description = primary.description?.[0] || primary.type || 'Unknown';
            return {
                text: `squawk ${squawk.code}: ${description}${suffix}`,
                warn: this.codePriorities[squawk.code] <= 3 || this.typePriorities[primary.type] <= 3,
                squawkInfo: {
                    code: squawk.code,
                    type: primary.type,
                    description,
                    matches: squawk.matches,
                },
            };
        }
        return {
            text: `squawk ${squawk.code}: unrecognized code`,
            warn: false,
            squawkInfo: { code: squawk.code },
        };
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
