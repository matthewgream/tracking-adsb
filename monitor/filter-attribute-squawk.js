// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Squawk code attribute aircraft detection module
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const tools = require('./tools-formats.js');

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

// Map squawk types to common categories
function mapSquawkTypeToCategory(squawkType) {
    const mapping = {
        emergency: 'emergency-services',
        sar: 'emergency-services',
        hems: 'emergency-services',
        police: 'emergency-services',
        royal: 'royalty',
        government: 'government',
        military: 'military',
        special: 'special-ops',
        danger_area: 'special-ops',
        display: 'special-interest',
        helicopter: 'special-interest',
        monitoring: 'special-interest',
        conspicuity: 'special-interest',
        approach: 'special-interest',
        tower: 'special-interest',
        radar: 'special-interest',
        fis: 'special-interest',
        service: 'special-interest',
        training: 'special-interest',
        uas: 'special-interest',
        ifr: 'special-interest',
        domestic: 'special-interest',
        transit: 'special-interest',
        offshore: 'special-interest',
        assigned: 'special-interest',
        ground: 'special-interest',
    };
    return mapping[squawkType] || 'special-interest';
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectSquawkPatterns(conf, aircraft, _categories) {
    if (!aircraft.squawk || !this.extra.data?.squawks) return [];

    const matches = this.extra.data.squawks.findByCode(aircraft.squawk);

    // Check if it's a watched code or type
    const isWatchedCode = this.conf.watchCodes.has(aircraft.squawk);
    const isWatchedType = matches.some((match) => this.conf.watchTypes.has(match.type));

    if (!isWatchedCode && !isWatchedType) return [];

    return matches.map((match) => ({
        detector: 'squawk',
        field: 'squawk',
        pattern: match.begin + (match.end ? '-' + match.end : ''),
        category: mapSquawkTypeToCategory(match.type),
        description: match.description?.[0] || match.type,
        confidence: 1,
        value: aircraft.squawk,
        metadata: {
            squawkType: match.type,
            allDescriptions: match.description,
            range: match,
        },
    }));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Anomaly detectors for squawk validation
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectGroundTestingMismatch(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const groundTestingMatch = squawkMatches.find((match) => match.begin === '0002');
    if (groundTestingMatch && aircraft.calculated?.altitude > 500)
        return {
            type: 'ground-testing-airborne',
            severity: 'high',
            confidence: 1,
            description: 'Ground transponder testing code used while airborne',
            details: `Using ground testing code 0002 at ${aircraft.calculated.altitude} ft`,
            field: 'squawk',
            value: aircraft.squawk,
        };
    return undefined;
}

function detectMilitarySquawkMismatch(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const militarySquawk = squawkMatches.find((match) => match.type === 'military' || (match.description && match.description.some((desc) => desc.toLowerCase().includes('military'))));
    if (militarySquawk && !aircraft.calculated?.military?.isMilitary)
        return {
            type: 'military-squawk-civilian',
            severity: 'medium',
            confidence: 0.8,
            description: 'Military transponder code on non-military callsign',
            details: `Military squawk ${aircraft.squawk} on apparent civilian flight`,
            field: 'squawk',
            value: aircraft.squawk,
        };
    return undefined;
}

function detectAltitudeMismatch(aircraft, _context) {
    if (aircraft.squawk === '7000' && aircraft.calculated?.altitude > 20000)
        return {
            type: 'vfr-high-altitude',
            severity: 'medium',
            confidence: 0.9,
            description: 'VFR code at IFR altitude',
            details: `VFR conspicuity code at FL${Math.round(aircraft.calculated.altitude / 100)}`,
            field: 'squawk',
            value: aircraft.squawk,
        };
    if (aircraft.squawk === '2000' && aircraft.calculated?.altitude < 1000 && aircraft.calculated?.altitude > 0)
        return {
            type: 'ifr-low-altitude',
            severity: 'low',
            confidence: 0.7,
            description: 'IFR code at very low altitude',
            details: `IFR conspicuity code at ${aircraft.calculated.altitude} ft`,
            field: 'squawk',
            value: aircraft.squawk,
        };
    return undefined;
}

function detectInappropriateSpecialUseCode(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const specialMatches = squawkMatches.filter((match) => match.type === 'special' || match.type === 'royal' || match.type === 'display');
    for (const match of specialMatches) {
        if (match.begin === '7003' && aircraft.gs && aircraft.gs < 200)
            return {
                type: 'display-code-slow-aircraft',
                severity: 'medium',
                confidence: 0.8,
                description: 'Display team code on slow aircraft',
                details: `Red Arrows display code at ${aircraft.gs} kts`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (match.type === 'royal' && aircraft.calculated?.altitude > 30000)
            return {
                type: 'royal-code-high-altitude',
                severity: 'low',
                confidence: 0.6,
                description: 'Royal flight code at unusually high altitude',
                details: `Royal flight code at FL${Math.round(aircraft.calculated.altitude / 100)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectModeSTesting(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const monitorMatch = squawkMatches.find((match) => match.begin === '7776' || match.begin === '7777');
    if (monitorMatch && aircraft.gs > 0)
        return {
            type: 'ssr-monitor-code-moving',
            severity: 'high',
            confidence: 1,
            description: 'Far Field Monitor code on moving aircraft',
            details: `Using SSR monitor code ${aircraft.squawk} while moving at ${aircraft.gs} kts`,
            field: 'squawk',
            value: aircraft.squawk,
        };
    return undefined;
}

function detectModeS1000Misuse(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const mode1000Match = squawkMatches.find((match) => match.begin === '1000');
    if (mode1000Match) {
        if (!aircraft.flight || aircraft.flight === '[' + aircraft.hex + ']')
            return {
                type: 'mode-s-1000-no-flight-id',
                severity: 'medium',
                confidence: 0.8,
                description: 'IFR Mode S code without validated flight ID',
                details: `Using Mode S code 1000 without proper flight identification`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.alt_baro && aircraft.alt_baro < 10000 && aircraft.alt_baro % 500 !== 0)
            return {
                type: 'mode-s-1000-vfr-altitude',
                severity: 'low',
                confidence: 0.6,
                description: 'IFR Mode S code at VFR altitude',
                details: `IFR code 1000 at VFR altitude ${aircraft.alt_baro} ft`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectAerobaticsCodeMisuse(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const aeroMatch = squawkMatches.find((match) => match.begin === '7004');
    if (aeroMatch) {
        if (aircraft.roll !== undefined && Math.abs(aircraft.roll) < 5 && aircraft.baro_rate !== undefined && Math.abs(aircraft.baro_rate) < 500)
            return {
                type: 'aerobatics-code-level-flight',
                severity: 'medium',
                confidence: 0.7,
                description: 'Display code in normal flight',
                details: `Aerobatics code 7004 in level flight (roll: ${aircraft.roll}°, climb: ${aircraft.baro_rate} fpm)`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.alt_baro > 20000)
            return {
                type: 'aerobatics-code-high-altitude',
                severity: 'high',
                confidence: 0.9,
                description: 'Display code above normal aerobatic altitude',
                details: `Aerobatics code at FL${Math.round(aircraft.alt_baro / 100)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectHighEnergyManeuversCode(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const hemMatch = squawkMatches.find((match) => match.begin === '7005');
    if (hemMatch) {
        if (aircraft.gs < 250)
            return {
                type: 'high-energy-code-slow-aircraft',
                severity: 'medium',
                confidence: 0.8,
                description: 'Fast jet code on slow aircraft',
                details: `High-energy maneuvers code 7005 at ${aircraft.gs} kts`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.alt_baro > 19500)
            return {
                type: 'high-energy-code-high-altitude',
                severity: 'high',
                confidence: 0.9,
                description: 'High-energy code above authorized altitude',
                details: `Code 7005 at FL${Math.round(aircraft.alt_baro / 100)} (only valid below FL195)`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectMonitoringCodeAnomalies(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const monitoringMatch = squawkMatches.find((match) => match.type === 'monitoring');
    if (monitoringMatch) {
        if (aircraft.alt_baro > 15000)
            return {
                type: 'monitoring-code-high-altitude',
                severity: 'low',
                confidence: 0.5,
                description: 'Airport monitoring code at high altitude',
                details: `Frequency monitoring code ${aircraft.squawk} at FL${Math.round(aircraft.alt_baro / 100)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.gs > 250)
            return {
                type: 'monitoring-code-high-speed',
                severity: 'medium',
                confidence: 0.7,
                description: 'Frequency monitoring code at high speed',
                details: `Monitoring code at ${aircraft.gs} kts`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectConspicuityConflicts(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const conspicuityMatch = squawkMatches.find((match) => match.type === 'conspicuity');
    if (conspicuityMatch) {
        if (aircraft.squawk === '7000' && aircraft.nav_modes && aircraft.nav_modes.includes('vnav'))
            return {
                type: 'vfr-conspicuity-ifr-equipment',
                severity: 'medium',
                confidence: 0.7,
                description: 'VFR conspicuity with IFR operations',
                details: `VFR code 7000 with IFR navigation modes active`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.squawk === '2000' && aircraft.alt_baro < 3000 && aircraft.gs < 100)
            return {
                type: 'ifr-conspicuity-low-slow',
                severity: 'low',
                confidence: 0.5,
                description: 'IFR conspicuity in VFR-like conditions',
                details: `IFR code 2000 at ${aircraft.alt_baro} ft and ${aircraft.gs} kts`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectUASAnomalies(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const uasMatch = squawkMatches.find((match) => match.type === 'uas');
    if (uasMatch) {
        if (aircraft.squawk === '7400' && aircraft.track_rate && Math.abs(aircraft.track_rate) > 3)
            return {
                type: 'uas-lost-link-maneuvering',
                severity: 'high',
                confidence: 0.9,
                description: 'UAS lost link code with active maneuvering',
                details: `Lost link code 7400 but maneuvering at ${aircraft.track_rate}°/s`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.squawk === '6000' && aircraft.alt_baro > 5000)
            return {
                type: 'uas-bvlos-high-altitude',
                severity: 'high',
                confidence: 0.8,
                description: 'UAS trial code at unexpected altitude',
                details: `BVLOS trial code at ${aircraft.alt_baro} ft`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectEmergencySquawkWithoutEmergency(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const emergencySquawk = squawkMatches.find((match) => match.type === 'emergency' || ['7500', '7600', '7700'].includes(match.begin));
    if (emergencySquawk) {
        if (!aircraft.emergency || aircraft.emergency === 'none')
            return {
                type: 'emergency-squawk-no-flag',
                severity: 'high',
                confidence: 0.9,
                description: 'Emergency code without corresponding emergency flag',
                details: `Emergency squawk ${aircraft.squawk} without emergency status`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.squawk === '7600' && aircraft.nav_heading && aircraft.true_heading && Math.abs(aircraft.nav_heading - aircraft.true_heading) > 30)
            return {
                type: 'radio-failure-heading-changes',
                severity: 'medium',
                confidence: 0.6,
                description: 'NORDO code with active navigation',
                details: `Radio failure code but heading changes detected`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectOffshoreCodeMisuse(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const offshoreMatch = squawkMatches.find((match) => match.type === 'offshore');
    if (offshoreMatch) {
        if (aircraft.alt_baro > 10000)
            return {
                type: 'offshore-code-high-altitude',
                severity: 'medium',
                confidence: 0.7,
                description: 'Offshore operations code at high altitude',
                details: `Offshore code ${aircraft.squawk} at FL${Math.round(aircraft.alt_baro / 100)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.gs > 200)
            return {
                type: 'offshore-code-high-speed',
                severity: 'medium',
                confidence: 0.8,
                description: 'Helicopter ops code on fast aircraft',
                details: `Offshore code at ${aircraft.gs} kts`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectMilitaryLowLevelMisuse(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const lowLevelMatch = squawkMatches.find((match) => match.begin === '7001');
    if (lowLevelMatch) {
        if (aircraft.alt_baro > 5000)
            return {
                type: 'military-low-level-high',
                severity: 'medium',
                confidence: 0.7,
                description: 'Low flying code above LFS altitude',
                details: `Military low level code at ${aircraft.alt_baro} ft`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (!aircraft.calculated?.military?.isMilitary && aircraft.gs < 200)
            return {
                type: 'military-low-level-civilian',
                severity: 'high',
                confidence: 0.8,
                description: 'Military LFS code on non-military aircraft',
                details: `Military code 7001 on apparent civilian aircraft`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectHelicopterCodeMismatch(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const heliMatch = squawkMatches.find(
        (match) => match.type === 'helicopter' || (match.description && match.description.some((desc) => desc.toLowerCase().includes('helicopter') || desc.toLowerCase().includes('rotary') || desc.toLowerCase().includes('hems')))
    );
    if (heliMatch && aircraft.category && aircraft.category !== 'A7') {
        if (heliMatch.description?.some((desc) => desc.includes('HEMS')) && ['A1', 'A2'].includes(aircraft.category)) return undefined;
        return {
            type: 'helicopter-code-fixed-wing',
            severity: 'high',
            confidence: 0.9,
            description: 'Rotorcraft code on fixed-wing aircraft',
            details: `Helicopter code ${aircraft.squawk} on ${tools.formatCategoryCode(aircraft.category) || 'non-rotorcraft'}`,
            field: 'squawk',
            value: aircraft.squawk,
        };
    }
    return undefined;
}

function detectLightAircraftCodeMismatch(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const gliderMatch = squawkMatches.find((match) => match.description?.some((desc) => desc.toLowerCase().includes('glider') || desc.toLowerCase().includes('towing')));
    if (gliderMatch) {
        if (aircraft.category && !['A1', 'B1', 'B4'].includes(aircraft.category))
            return {
                type: 'glider-ops-wrong-category',
                severity: 'medium',
                confidence: 0.7,
                description: 'Glider operations code on inappropriate aircraft',
                details: `Glider ops code ${aircraft.squawk} on ${tools.formatCategoryCode(aircraft.category)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectSurfaceVehicleCodeAirborne(aircraft, context) {
    if (aircraft.category && ['C1', 'C2'].includes(aircraft.category)) {
        if (aircraft.alt_baro > 100 || aircraft.gs > 80)
            return {
                type: 'surface-vehicle-airborne',
                severity: 'high',
                confidence: 0.9,
                description: 'Surface vehicle category appears airborne',
                details: `Surface vehicle category ${aircraft.category} at ${aircraft.alt_baro} ft / ${aircraft.gs} kts`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const groundMatch = squawkMatches.find((match) => match.type === 'ground');
    if (groundMatch && aircraft.category && aircraft.category.startsWith('A')) {
        if (aircraft.gs > 50)
            return {
                type: 'ground-code-moving-aircraft',
                severity: 'high',
                confidence: 0.9,
                description: 'Ground equipment code on moving aircraft',
                details: `Ground code ${aircraft.squawk} on moving aircraft at ${aircraft.gs} kts`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectUAVCategoryAnomalies(aircraft, context) {
    if (aircraft.category === 'B6') {
        const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
        const mannedCodes = squawkMatches.find((match) => ['military', 'royal', 'police', 'hems'].includes(match.type) && !match.description?.some((desc) => desc.toLowerCase().includes('uas') || desc.toLowerCase().includes('unmanned')));
        if (mannedCodes)
            return {
                type: 'uav-manned-aircraft-code',
                severity: 'medium',
                confidence: 0.7,
                description: 'Drone with manned aircraft transponder code',
                details: `UAV using manned aircraft code ${aircraft.squawk}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.squawk === '7000')
            return {
                type: 'uav-vfr-conspicuity',
                severity: 'high',
                confidence: 0.9,
                description: 'Unmanned aircraft on VFR code',
                details: `UAV using VFR conspicuity code`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectAircraftSizeMismatch(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const lightMatch = squawkMatches.find((match) => match.description?.some((desc) => desc.toLowerCase().includes('light aircraft') || desc.toLowerCase().includes('microlight') || desc.toLowerCase().includes('ultralight')));
    if (lightMatch && aircraft.category && ['A3', 'A4', 'A5'].includes(aircraft.category))
        return {
            type: 'heavy-aircraft-light-code',
            severity: 'medium',
            confidence: 0.6,
            description: 'Large aircraft using light aircraft code',
            details: `${tools.formatCategoryCode(aircraft.category)} using light aircraft code ${aircraft.squawk}`,
            field: 'squawk',
            value: aircraft.squawk,
        };
    return undefined;
}

function detectParachutingCodeValidation(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const paraMatch = squawkMatches.find((match) => match.begin === '0033');
    if (paraMatch) {
        if (aircraft.category && ['A4', 'A5'].includes(aircraft.category))
            return {
                type: 'paradrop-heavy-aircraft',
                severity: 'low',
                confidence: 0.5,
                description: 'Unusually large aircraft for parachuting ops',
                details: `Heavy aircraft ${tools.formatCategoryCode(aircraft.category)} using paradrop code`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.alt_baro && (aircraft.alt_baro < 3000 || aircraft.alt_baro > 20000))
            return {
                type: 'paradrop-altitude-unusual',
                severity: 'medium',
                confidence: 0.7,
                description: 'Parachuting code at unusual altitude',
                details: `Paradrop code at ${aircraft.alt_baro} ft`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectDescriptionBasedAnomalies(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const anomalies = [];

    squawkMatches
        .filter((match) => match.description)
        .forEach((match) => {
            match.description.forEach((desc) => {
                const lowerDesc = desc.toLowerCase();

                if (lowerDesc.includes('shall only be selected with atc direction') || lowerDesc.includes('only be selected with atc direction')) {
                    if (aircraft.category && ['B1', 'B4'].includes(aircraft.category))
                        anomalies.push({
                            type: 'atc-directed-code-light-aircraft',
                            severity: 'medium',
                            confidence: 0.6,
                            description: 'Restricted code on recreational aircraft',
                            details: `ATC-directed code ${aircraft.squawk} on ${tools.formatCategoryCode(aircraft.category)}`,
                            field: 'squawk',
                            value: aircraft.squawk,
                        });
                }

                if (/within \d+ nm/i.test(lowerDesc) && aircraft.gs > 250)
                    anomalies.push({
                        type: 'local-code-high-speed',
                        severity: 'low',
                        confidence: 0.5,
                        description: 'Distance-restricted code on fast aircraft',
                        details: `Local area code ${aircraft.squawk} at ${aircraft.gs} kts`,
                        field: 'squawk',
                        value: aircraft.squawk,
                    });

                const altMatch = lowerDesc.match(/(?:below|under) (?:fl\s*)?(\d+)/i);
                if (altMatch) {
                    const maxAlt = Number.parseInt(altMatch[1]) * (altMatch[0].includes('fl') ? 100 : 1);
                    if (aircraft.alt_baro > maxAlt)
                        anomalies.push({
                            type: 'altitude-restricted-code',
                            severity: 'high',
                            confidence: 0.8,
                            description: 'Altitude-restricted code exceeded',
                            details: `Code ${aircraft.squawk} above ${maxAlt} ft restriction`,
                            field: 'squawk',
                            value: aircraft.squawk,
                        });
                }

                if (lowerDesc.includes('helicopter') && aircraft.category !== 'A7')
                    anomalies.push({
                        type: 'helicopter-only-code',
                        severity: 'high',
                        confidence: 0.8,
                        description: 'Rotorcraft-specific code misuse',
                        details: `Helicopter-only code on ${tools.formatCategoryCode(aircraft.category)}`,
                        field: 'squawk',
                        value: aircraft.squawk,
                    });

                if (lowerDesc.includes('conspicuity') && aircraft.flight && !aircraft.flight.includes('[') && ['approach', 'tower', 'radar'].some((service) => squawkMatches.some((m) => m.type === service)))
                    anomalies.push({
                        type: 'conspicuity-with-service',
                        severity: 'low',
                        confidence: 0.4,
                        description: 'Conspicuity code possibly receiving service',
                        details: `Conspicuity code ${aircraft.squawk} with apparent ATC service`,
                        field: 'squawk',
                        value: aircraft.squawk,
                    });
            });
        });

    return anomalies.length > 0 ? anomalies : undefined;
}

function detectSAROperationsValidation(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const sarMatch = squawkMatches.find((match) => match.begin === '0023');
    if (sarMatch) {
        if (aircraft.category && ['B1', 'B4', 'C1', 'C2'].includes(aircraft.category))
            return {
                type: 'sar-inappropriate-category',
                severity: 'high',
                confidence: 0.8,
                description: 'Search and rescue code on inappropriate vehicle',
                details: `SAR code on ${tools.formatCategoryCode(aircraft.category)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.alt_baro > 15000)
            return {
                type: 'sar-high-altitude',
                severity: 'medium',
                confidence: 0.6,
                description: 'Search and rescue code at cruise altitude',
                details: `SAR operations at FL${Math.round(aircraft.alt_baro / 100)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

function detectTrainingCodeValidation(aircraft, context) {
    const squawkMatches = context.extra.data?.squawks?.findByCode(aircraft.squawk) || [];
    const studentMatch = squawkMatches.find((match) => match.description?.some((desc) => desc.toLowerCase().includes('student')));
    if (studentMatch) {
        if (aircraft.category && !['A1', 'A2', 'B1'].includes(aircraft.category))
            return {
                type: 'student-large-aircraft',
                severity: 'medium',
                confidence: 0.7,
                description: 'Training code on large aircraft',
                details: `Student pilot code on ${tools.formatCategoryCode(aircraft.category)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
        if (aircraft.alt_baro > 10000)
            return {
                type: 'student-high-altitude',
                severity: 'medium',
                confidence: 0.6,
                description: 'Training code above typical training altitude',
                details: `Student code at FL${Math.round(aircraft.alt_baro / 100)}`,
                field: 'squawk',
                value: aircraft.squawk,
            };
    }
    return undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'squawk',
    name: 'Squawk code pattern detection',

    config: (conf, extra, categories) => {
        this.conf = conf || {};
        this.extra = extra;
        this.categories = categories;

        if (this.extra.data?.squawks === undefined) console.error('filter-attribute-squawk: squawk data not available');

        this.conf.typePriorities = this.conf.typePriorities || DEFAULT_TYPE_PRIORITIES;
        this.conf.codePriorities = this.conf.codePriorities || DEFAULT_CODE_PRIORITIES;
        this.conf.watchCodes = new Set(this.conf.watchCodes || Object.keys(DEFAULT_CODE_PRIORITIES));
        this.conf.watchTypes = new Set(this.conf.watchTypes || ['emergency', 'sar', 'hems', 'police', 'royal', 'military', 'special']);

        // Log configuration
        if (this.extra.data?.squawks) console.error(`filter-attribute-squawk: configured: watching ${this.conf.watchCodes.size} codes, ${this.conf.watchTypes.size} types (${[...this.conf.watchTypes].join(', ')})`);
    },

    detect: (conf, aircraft, categories) => detectSquawkPatterns(this.conf, aircraft, categories),

    detectors: [
        detectGroundTestingMismatch,
        detectMilitarySquawkMismatch,
        detectAltitudeMismatch,
        detectInappropriateSpecialUseCode,
        detectModeSTesting,
        detectModeS1000Misuse,
        detectAerobaticsCodeMisuse,
        detectHighEnergyManeuversCode,
        detectMonitoringCodeAnomalies,
        detectConspicuityConflicts,
        detectUASAnomalies,
        detectEmergencySquawkWithoutEmergency,
        detectOffshoreCodeMisuse,
        detectMilitaryLowLevelMisuse,
        detectHelicopterCodeMismatch,
        detectLightAircraftCodeMismatch,
        detectSurfaceVehicleCodeAirborne,
        detectUAVCategoryAnomalies,
        detectAircraftSizeMismatch,
        detectParachutingCodeValidation,
        detectDescriptionBasedAnomalies,
        detectSAROperationsValidation,
        detectTrainingCodeValidation,
    ],
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
