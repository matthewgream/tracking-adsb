// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function getMinDescentRate(category) {
    switch (category) {
        case 'A0': // No information
        case 'A1': // Light aircraft (<15.5k lbs)
            return -200; // Lighter aircraft can land with shallower descent
        case 'A2': // Small (15.5-75k lbs)
            return -250;
        case 'A3': // Large (75-300k lbs)
        case 'A4': // High-Vortex Large (B757)
        case 'A5': // Heavy (>300k lbs)
            return -300;
        case 'A7': // Rotorcraft
            return -100; // Helicopters can have very shallow descents
        case 'B1': // Glider
            return -150; // Gliders have shallow descent rates
        case 'B4': // Ultralight
            return -150;
        case 'B6': // UAV/Drone
            return -100;
        default:
            return -250; // Conservative default
    }
}

function getMinClimbRate(category) {
    switch (category) {
        case 'A0': // No information
        case 'A1': // Light aircraft (<15.5k lbs)
            return 200; // Light aircraft can take off with lower climb rates
        case 'A2': // Small (15.5-75k lbs)
            return 250;
        case 'A3': // Large (75-300k lbs)
        case 'A4': // High-Vortex Large (B757)
        case 'A5': // Heavy (>300k lbs)
            return 300; // Heavy aircraft need higher climb rates to be significant
        case 'A7': // Rotorcraft
            return 100; // Helicopters can have very low climb rates
        case 'B1': // Glider
            return 150; // Gliders have low climb rates
        case 'B4': // Ultralight
            return 150; // Ultralights climb slowly
        case 'B6': // UAV/Drone
            return 100; // Small drones
        default:
            return 250; // Conservative default
    }
}

function estimateDepartureTime(currentAltitude, currentClimbRate, aircraftCategory = undefined) {
    let avgClimbRate;
    switch (aircraftCategory) {
        case 'A1': // Light aircraft
            avgClimbRate = Math.min(currentClimbRate * 1.2, 700);
            break;
        case 'A2': // Small aircraft
            avgClimbRate = Math.min(currentClimbRate * 1.3, 1500);
            break;
        case 'A3': // Large aircraft
        case 'A4': // B757
        case 'A5': // Heavy aircraft
            avgClimbRate = Math.min(currentClimbRate * 1.5, 2500);
            break;
        case 'A7': // Rotorcraft
            avgClimbRate = Math.min(currentClimbRate * 1.1, 500);
            break;
        default:
            // Conservative estimate
            avgClimbRate = currentClimbRate * 1.3;
    }

    const minutesSinceDeparture = currentAltitude / avgClimbRate;

    return {
        departureTime: new Date(Date.now() - minutesSinceDeparture * 60 * 1000),
        minutesSinceDeparture: Number(minutesSinceDeparture.toFixed(2)),
        assumedAvgClimbRate: Number(avgClimbRate.toFixed(0)),
    };
}

function estimateCruiseAltitude(currentAltitude, currentClimbRate, aircraftCategory = undefined) {
    const typicalCruise = {
        A1: 15000, // Light aircraft
        A2: 25000, // Small aircraft
        A3: 37000, // Large aircraft
        A4: 39000, // B757
        A5: 41000, // Heavy aircraft
        A7: 5000, // Rotorcraft
        B1: 20000, // Glider
        B4: 5000, // Ultralight
        B6: 10000, // UAV/Drone
    };
    const defaultCruise = 30000;
    const categoryCruise = typicalCruise[aircraftCategory] || defaultCruise;
    // Lower climb rates might indicate lower planned cruise
    if (currentClimbRate < 500 && currentAltitude > 5000) return Math.min(categoryCruise, currentAltitude + 5000);

    return categoryCruise;
}

function getAircraftCategoryInfo(category) {
    const categoryInfo = {
        // Fixed-wing aircraft
        A0: {
            name: 'No Information',
            type: 'unknown',
            description: 'No category information available',
            typical: {
                cruise: 30000,
                speed: 300,
                climb: 1000,
                service_ceiling: 40000,
            },
        },
        A1: {
            name: 'Light',
            type: 'fixed-wing',
            description: 'Light aircraft (<15,500 lbs / 7,000 kg)',
            typical: {
                cruise: 12000,
                speed: 150,
                climb: 700,
                service_ceiling: 20000,
                approach_speed: 65,
            },
        },
        A2: {
            name: 'Small',
            type: 'fixed-wing',
            description: 'Small aircraft (15,500-75,000 lbs / 7,000-34,000 kg)',
            typical: {
                cruise: 25000,
                speed: 280,
                climb: 1500,
                service_ceiling: 35000,
                approach_speed: 120,
            },
        },
        A3: {
            name: 'Large',
            type: 'fixed-wing',
            description: 'Large aircraft (75,000-300,000 lbs / 34,000-136,000 kg)',
            typical: {
                cruise: 37000,
                speed: 460,
                climb: 2000,
                service_ceiling: 42000,
                approach_speed: 140,
            },
        },
        A4: {
            name: 'High-Vortex Large',
            type: 'fixed-wing',
            description: 'Boeing 757',
            typical: {
                cruise: 39000,
                speed: 470,
                climb: 2200,
                service_ceiling: 42000,
                approach_speed: 135,
            },
        },
        A5: {
            name: 'Heavy',
            type: 'fixed-wing',
            description: 'Heavy aircraft (>300,000 lbs / 136,000 kg)',
            typical: {
                cruise: 41000,
                speed: 490,
                climb: 2500,
                service_ceiling: 45000,
                approach_speed: 150,
            },
        },
        A6: {
            name: 'High Performance',
            type: 'fixed-wing',
            description: 'High performance (>5g and >400 kts)',
            typical: {
                cruise: 45000,
                speed: 600,
                climb: 6000,
                service_ceiling: 60000,
                approach_speed: 180,
            },
        },
        A7: {
            name: 'Rotorcraft',
            type: 'rotorcraft',
            description: 'Helicopters',
            typical: {
                cruise: 5000,
                speed: 140,
                climb: 500,
                service_ceiling: 15000,
                approach_speed: 60,
                hover_capable: true,
            },
        },

        // Other aircraft types
        B0: {
            name: 'No Information',
            type: 'unknown',
            description: 'No category information available',
            typical: {
                cruise: 10000,
                speed: 100,
                climb: 300,
                service_ceiling: 15000,
            },
        },
        B1: {
            name: 'Glider/Sailplane',
            type: 'glider',
            description: 'Unpowered gliders and sailplanes',
            typical: {
                cruise: 15000,
                speed: 80,
                climb: 300, // thermal climb
                sink_rate: 200, // ft/min
                service_ceiling: 25000,
                approach_speed: 55,
            },
        },
        B2: {
            name: 'Lighter-than-air',
            type: 'balloon',
            description: 'Balloons and airships',
            typical: {
                cruise: 3000,
                speed: 35,
                climb: 300,
                service_ceiling: 10000,
            },
        },
        B3: {
            name: 'Parachutist/Skydiver',
            type: 'parachutist',
            description: 'Skydivers and parachutists',
            typical: {
                cruise: 0,
                speed: 120, // terminal velocity
                climb: 0,
                descent_rate: 1000,
                deployment_alt: 3000,
            },
        },
        B4: {
            name: 'Ultralight',
            type: 'ultralight',
            description: 'Ultralight/hang-glider/paraglider',
            typical: {
                cruise: 5000,
                speed: 55,
                climb: 300,
                service_ceiling: 10000,
                approach_speed: 35,
            },
        },
        B5: {
            name: 'Reserved',
            type: 'reserved',
            description: 'Reserved for future use',
            typical: {},
        },
        B6: {
            name: 'UAV/Drone',
            type: 'uav',
            description: 'Unmanned aerial vehicle',
            typical: {
                cruise: 10000,
                speed: 100,
                climb: 500,
                service_ceiling: 20000,
                endurance: 1440, // minutes
            },
        },
        B7: {
            name: 'Space Vehicle',
            type: 'space',
            description: 'Space/Trans-atmospheric vehicle',
            typical: {
                cruise: 100000,
                speed: 5000,
                climb: 20000,
                service_ceiling: 330000, // edge of space
            },
        },

        // Surface vehicles
        C0: {
            name: 'No Information',
            type: 'surface',
            description: 'No category information available',
            typical: {
                cruise: 0,
                speed: 30,
                max_altitude: 100,
            },
        },
        C1: {
            name: 'Emergency Vehicle',
            type: 'surface',
            description: 'Surface emergency vehicle',
            typical: {
                cruise: 0,
                speed: 60,
                max_altitude: 50,
            },
        },
        C2: {
            name: 'Service Vehicle',
            type: 'surface',
            description: 'Surface service vehicle',
            typical: {
                cruise: 0,
                speed: 30,
                max_altitude: 50,
            },
        },
        C3: {
            name: 'Point Obstacle',
            type: 'obstacle',
            description: 'Fixed point obstacle (includes tethered balloons)',
            typical: {
                cruise: 0,
                speed: 0,
                fixed: true,
            },
        },
        C4: {
            name: 'Cluster Obstacle',
            type: 'obstacle',
            description: 'Cluster of obstacles',
            typical: {
                cruise: 0,
                speed: 0,
                fixed: true,
            },
        },
        C5: {
            name: 'Line Obstacle',
            type: 'obstacle',
            description: 'Line obstacle (power lines, cables)',
            typical: {
                cruise: 0,
                speed: 0,
                fixed: true,
            },
        },
        C6: {
            name: 'Reserved',
            type: 'reserved',
            description: 'Reserved for future use',
            typical: {},
        },
        C7: {
            name: 'Reserved',
            type: 'reserved',
            description: 'Reserved for future use',
            typical: {},
        },
    };

    // Default for any unknown categories (including D0-D7)
    const defaultInfo = {
        name: 'Unknown Category',
        type: 'unknown',
        description: `Unknown category: ${category}`,
        typical: {
            cruise: 20000,
            speed: 250,
            climb: 1000,
            service_ceiling: 35000,
        },
    };

    return categoryInfo[category] || defaultInfo;
}

function isLightAircraft(category) {
    return ['A1', 'B1', 'B4'].includes(category);
}

function isHeavyAircraft(category) {
    return ['A4', 'A5'].includes(category);
}

function isRotorcraft(category) {
    return category === 'A7';
}

function isSurfaceVehicle(category) {
    return ['C1', 'C2'].includes(category);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function getApproachSpeedIndicator(aircraft) {
    const categorySpeedRanges = {
        A1: { min: 60, normal: 80, max: 100 },
        A2: { min: 100, normal: 130, max: 160 },
        A3: { min: 120, normal: 140, max: 180 },
        A4: { min: 120, normal: 135, max: 170 },
        A5: { min: 130, normal: 150, max: 190 },
        A7: { min: 0, normal: 60, max: 100 },
    };

    const speeds = categorySpeedRanges[aircraft.category] || categorySpeedRanges.A3;

    if (aircraft.gs < speeds.min) return 'slow';
    if (aircraft.gs > speeds.max) return 'fast';
    return 'normal';
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Get required wake turbulence separation
 * @private
 */
function getRequiredWakeSeparation(leadingCategory, followingCategory) {
    // ICAO wake turbulence categories
    // A5 (Heavy), A4 (B757), A3 (Large), A2 (Small), A1 (Light)

    const separationMatrix = {
        A5: {
            // Heavy leading
            A5: { distance: 4, reason: 'Heavy behind Heavy' },
            A4: { distance: 5, reason: 'B757 behind Heavy' },
            A3: { distance: 5, reason: 'Large behind Heavy' },
            A2: { distance: 6, reason: 'Small behind Heavy' },
            A1: { distance: 6, reason: 'Light behind Heavy' },
        },
        A4: {
            // B757 leading (special case)
            A5: { distance: 4, reason: 'Heavy behind B757' },
            A4: { distance: 4, reason: 'B757 behind B757' },
            A3: { distance: 5, reason: 'Large behind B757' },
            A2: { distance: 5, reason: 'Small behind B757' },
            A1: { distance: 5, reason: 'Light behind B757' },
        },
        A3: {
            // Large leading
            A5: { distance: 3, reason: 'Heavy behind Large' },
            A4: { distance: 3, reason: 'B757 behind Large' },
            A3: { distance: 3, reason: 'Large behind Large' },
            A2: { distance: 4, reason: 'Small behind Large' },
            A1: { distance: 4, reason: 'Light behind Large' },
        },
    };

    // Default separation
    const defaultSep = { distance: 3, reason: 'Standard separation' };

    return separationMatrix[leadingCategory]?.[followingCategory] || defaultSep;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    getAircraftCategoryInfo,
    isLightAircraft,
    isHeavyAircraft,
    isRotorcraft,
    isSurfaceVehicle,
    getMinDescentRate,
    getMinClimbRate,
    //
    estimateDepartureTime,
    estimateCruiseAltitude,
    //
    getApproachSpeedIndicator,
    getRequiredWakeSeparation,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
