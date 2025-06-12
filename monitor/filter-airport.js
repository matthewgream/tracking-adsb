// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// filter-airport.js - Aircraft near airport detection with enhanced analysis
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

const helpers = require('./filter-helpers.js');
const tools = { ...require('./tools-geometry.js'), ...require('./tools-statistics.js'), ...require('./tools-formats.js') };
const aircraftInfo = require('./aircraft-info.js');

const detectors = require('./filter-airport-detectors.js');

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// aircraft oriented
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function detectAirportsNearby(conf, extra, aircraft, aircraftData, aircraftList) {
    if (aircraft.lat === undefined || aircraft.lon === undefined) return undefined;

    // Get all airports within ATZ range for basic detection
    const airportsInATZ = extra.data.airports.findNearby(aircraft.lat, aircraft.lon, {
        altitude: aircraft.calculated?.altitude,
    });

    // For runway alignment, we need to check a larger area
    const alignmentDistance = detectors.getRunwayAlignmentDistance(aircraft, conf.runwayAlignmentDistance);
    const airportsForAlignment = extra.data.airports.findNearby(aircraft.lat, aircraft.lon, {
        distance: alignmentDistance,
        altitude: aircraft.calculated?.altitude,
    });

    // Use ATZ airports for basic "near airport" detection
    if (airportsInATZ.length === 0) return undefined;

    // Filter out incompatible airports using helper function
    const compatibleAirports = airportsInATZ.filter((airport) => helpers.isAirportCompatibleWithAircraft(airport, aircraft));

    // If no compatible airports, don't trigger the filter
    if (compatibleAirports.length === 0) return undefined;

    // Create a map of all airports for alignment checking
    const alignmentAirportMap = new Map(airportsForAlignment.map((apt) => [apt.icao_code, apt]));

    // Enhance airport data with additional analysis
    const enhancedAirports = compatibleAirports.map((airport) => {
        const enhanced = { ...airport };

        // For runway alignment, use the version with extended search if available
        const airportForAlignment = alignmentAirportMap.get(airport.icao_code) || airport;

        // Check runway alignment with trajectory data and scoring
        // Use extended distance criteria for alignment detection
        if (detectors.shouldCheckRunwayAlignment(aircraft, airportForAlignment, alignmentDistance)) {
            const alignedRunway = helpers.findAlignedRunwayWithScore(airportForAlignment, aircraft, aircraftData);
            if (alignedRunway) {
                enhanced.alignedRunway = alignedRunway;
                enhanced.runwayAlignmentScore = alignedRunway.confidenceScore;
            }
        }

        // Rest of the enhancement logic remains the same...
        // Add approach/departure likelihood based on altitude and vertical rate
        if (aircraft.calculated?.altitude && aircraft.baro_rate) {
            if (aircraft.calculated.altitude < 3000 && aircraft.baro_rate < -200) {
                enhanced.phase = 'approaching';
                enhanced.phaseConfidence = Math.min(1, Math.abs(aircraft.baro_rate) / 1000);
            } else if (aircraft.calculated.altitude < 3000 && aircraft.baro_rate > 200) {
                enhanced.phase = 'departing';
                enhanced.phaseConfidence = Math.min(1, aircraft.baro_rate / 1000);
            } else if (aircraft.calculated.altitude < 1500) {
                enhanced.phase = 'ground_operations';
                enhanced.phaseConfidence = 0.8;
            }
        }

        // Calculate overall relevance score
        enhanced.relevanceScore = calculateAirportRelevanceScore(enhanced, aircraft);

        // Go-around detection
        if (airport.distance < 10 && aircraft.calculated?.altitude < 3000) {
            const goAround = detectors.detectGoAround(aircraft, aircraftData, airport);
            if (goAround?.detected) {
                enhanced.phase = 'go_around';
                enhanced.goAround = goAround;
                enhanced.phaseConfidence = goAround.confidence;
            }
        }

        // Holding pattern detection
        const holding = detectors.detectHoldingPattern(aircraftData);
        if (holding?.detected && airport.distance < 20) {
            enhanced.holdingPattern = holding;
            if (!enhanced.phase) {
                enhanced.phase = 'holding';
            }
        }

        // Queue position (only for priority airports)
        if (conf.priorities?.includes(airport.icao_code) && aircraftList) {
            enhanced.queueInfo = detectors.detectQueuePosition(aircraft, enhanced, aircraftList);
        }

        // Pattern work detection (for smaller airports)
        if (airport.type !== 'large_airport' && airport.distance < 5) {
            // Check for traffic pattern
            const pattern = detectors.detectTrafficPattern(aircraft, aircraftData, airport);
            if (pattern?.detected) {
                enhanced.phase = 'pattern';
                enhanced.pattern = pattern;
                enhanced.phaseConfidence = 0.8;
            }

            // Check for overhead join
            const overhead = detectors.detectOverheadJoin(aircraft, aircraftData, airport);
            if (overhead?.detected) {
                enhanced.phase = 'overhead_join';
                enhanced.overheadJoin = overhead;
                enhanced.phaseConfidence = 0.9;
            }

            // Check for touch-and-go
            const touchAndGo = detectors.detectTouchAndGo(aircraft, aircraftData, airport);
            if (touchAndGo?.detected) {
                enhanced.phase = 'touch_and_go';
                enhanced.touchAndGo = touchAndGo;
                enhanced.phaseConfidence = 0.85;
            }
        }

        // Missed approach detection (more specific than go-around)
        if (airport.distance < 10 && aircraft.calculated?.altitude < 3000) {
            const missedApproach = detectors.detectMissedApproach(aircraft, aircraftData, airport);
            if (missedApproach?.detected) {
                enhanced.phase = 'missed_approach';
                enhanced.missedApproach = missedApproach;
                enhanced.phaseConfidence = missedApproach.confidence;
            }
        }

        // Approach type detection
        if (enhanced.phase === 'approaching' && enhanced.alignedRunway) {
            const approachType = detectors.detectApproachType(aircraft, aircraftData, enhanced);
            if (approachType?.detected) {
                enhanced.approachType = approachType;
                // Update phase to be more specific
                enhanced.phase = approachType.phase || 'approaching';
            }
        }

        // Wake turbulence analysis (for approaching aircraft at priority airports)
        if (enhanced.phase === 'approaching' && conf.priorities?.includes(airport.icao_code) && aircraftList) {
            const wakeSeparation = detectors.analyzeWakeSeparation(aircraft, enhanced, aircraftList);
            if (wakeSeparation?.detected) {
                enhanced.wakeSeparation = wakeSeparation;
            }
        }

        // Weather avoidance detection
        const weatherAvoidance = detectors.detectWeatherAvoidance(aircraft, aircraftData, airport);
        if (weatherAvoidance?.detected) {
            if (!enhanced.phase || enhanced.phase === 'nearby') {
                enhanced.phase = 'weather_avoidance';
            }
            enhanced.weatherAvoidance = weatherAvoidance;
        }

        // Calculate runway occupancy time for departing aircraft
        if (enhanced.phase === 'departing' && airport.distance < 2) {
            const occupancyTime = detectors.calculateRunwayOccupancyTime(aircraft, aircraftData, enhanced);
            if (occupancyTime) {
                enhanced.runwayOccupancyTime = occupancyTime;
            }
        }

        // Enhanced pattern analysis with duration
        if (enhanced.pattern?.detected) {
            // Calculate how long aircraft has been in pattern
            const positions = aircraftData.getPositions({ maxDataPoints: 50 });
            if (positions.length > 20) {
                const duration = (positions[positions.length - 1].timestamp - positions[0].timestamp) / 1000;
                enhanced.pattern.duration = duration;
            }
        }

        return enhanced;
    });

    // Sort airports by relevance score
    enhancedAirports.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {
        hasAirportsNearby: true,
        airports: enhancedAirports,
        compatibleCount: compatibleAirports.length,
        totalCount: airportsInATZ.length,
        bestMatch: enhancedAirports[0],
    };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

function calculateAirportRelevanceScore(airport, aircraft) {
    let score = 0;

    // Distance factor (closer is more relevant)
    const distanceFactor = Math.max(0, 1 - airport.distance / 10); // 10km = 0 score
    score += distanceFactor * 0.3;

    // Runway alignment factor
    if (airport.runwayAlignmentScore) {
        score += airport.runwayAlignmentScore * 0.3;
    }

    // Phase confidence factor
    if (airport.phaseConfidence) {
        score += airport.phaseConfidence * 0.2;
    }

    // Airport size vs aircraft size compatibility factor
    const sizeFactor = helpers.calculateAirportSizeCompatibilityFactor(airport, aircraft);
    score += sizeFactor * 0.2;

    // Additional factors based on aircraft state

    // Speed factor - slower speeds near airports are more relevant
    if (aircraft.gs) {
        const speedFactor = helpers.isAircraftAtAirportSpeed(aircraft) ? 0.05 : 0;
        score += speedFactor;
    }

    // Altitude factor - lower altitudes near airports are more relevant
    if (aircraft.calculated?.altitude) {
        const altitudeFactor = helpers.isAircraftAtAirportAltitude(aircraft) ? 0.05 : 0;
        score += altitudeFactor;
    }

    // Squawk code factor - certain codes indicate airport operations
    if (aircraft.squawk) {
        const squawkFactor = helpers.getSquawksForAirport(airport).includes(aircraft.squawk) ? 0.1 : 0;
        score += squawkFactor;
    }

    return Math.min(1, score);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// airport oriented
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Analyze traffic at a specific airport
 * @param {string} icao_code - Airport ICAO code
 * @param {Array} aircraftList - All aircraft with airport data
 * @returns {Object} Airport analysis data
 */
function analyzeAirportTraffic(icao_code, aircraftList) {
    const analysis = {
        icao_code,
        timestamp: new Date().toISOString(),
        aircraft: {
            total: 0,
            ground: 0,
            approaching: 0,
            departing: 0,
            nearby: 0,
            aligned: 0,
        },
        runways: {},
        statistics: {
            distances: [],
            altitudes: [],
            alignmentScores: [],
        },
    };

    // Filter aircraft near this airport
    aircraftList.forEach((aircraft) => {
        if (!aircraft.calculated?.airports_nearby?.hasAirportsNearby) return;

        const airport = aircraft.calculated.airports_nearby.airports.find((apt) => apt.icao_code === icao_code);

        if (!airport) return;

        // Add aircraft to analysis
        addAircraftToAnalysis(analysis, aircraft, airport);
    });

    // Calculate derived statistics
    calculateAirportStatistics(analysis);

    // Analyze runway activity
    analyzeRunwayActivity(analysis, aircraftList);

    return analysis;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Add a single aircraft to airport analysis
 * @private
 */
function addAircraftToAnalysis(analysis, aircraft, airport) {
    analysis.aircraft.total++;

    // Track statistics
    if (airport.distance) {
        analysis.statistics.distances.push(airport.distance);
    }
    if (aircraft.calculated?.altitude) {
        analysis.statistics.altitudes.push(aircraft.calculated.altitude);
    }

    // Categorize by phase
    if (airport.phase) {
        switch (airport.phase) {
            case 'ground_operations':
                analysis.aircraft.ground++;
                break;
            case 'approaching':
                analysis.aircraft.approaching++;
                break;
            case 'departing':
                analysis.aircraft.departing++;
                break;
        }
    } else {
        analysis.aircraft.nearby++;
    }

    // console.error(airport.icao_code + ' --> ' + aircraft.flight);

    // Process runway alignment
    if (airport.alignedRunway) {
        analysis.aircraft.aligned++;
        analysis.statistics.alignmentScores.push(airport.alignedRunway.alignmentScore);

        const runwayKey = airport.alignedRunway.runwayName;
        if (!analysis.runways[runwayKey]) {
            analysis.runways[runwayKey] = {
                name: runwayKey,
                aircraft: [],
                phases: { approaching: 0, departing: 0, other: 0 },
            };
        }

        const runwayData = analysis.runways[runwayKey];
        runwayData.aircraft.push({
            flight: aircraft.flight || aircraft.hex,
            category: aircraft.category,
            alignmentScore: airport.alignedRunway.alignmentScore,
            confidenceScore: airport.alignedRunway.confidenceScore,
            phase: airport.phase || 'other',
            altitude: aircraft.calculated?.altitude,
            distance: airport.distance,
            speed: aircraft.gs,
            track: aircraft.track,
        });

        // Count phases
        const phase = airport.phase || 'other';
        if (runwayData.phases[phase] !== undefined) {
            runwayData.phases[phase]++;
        }
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Calculate aggregate statistics for airport
 * @private
 */
function calculateAirportStatistics(analysis) {
    const stats = analysis.statistics;

    // Distance statistics
    if (stats.distances.length > 0) {
        analysis.distanceStats = {
            min: Math.min(...stats.distances),
            max: Math.max(...stats.distances),
            average: stats.distances.reduce((a, b) => a + b, 0) / stats.distances.length,
            count: stats.distances.length,
        };
    }

    // Altitude statistics
    if (stats.altitudes.length > 0) {
        analysis.altitudeStats = {
            min: Math.min(...stats.altitudes),
            max: Math.max(...stats.altitudes),
            average: stats.altitudes.reduce((a, b) => a + b, 0) / stats.altitudes.length,
            count: stats.altitudes.length,
        };
    }

    // Alignment statistics
    if (stats.alignmentScores.length > 0) {
        analysis.alignmentStats = {
            min: Math.min(...stats.alignmentScores),
            max: Math.max(...stats.alignmentScores),
            average: stats.alignmentScores.reduce((a, b) => a + b, 0) / stats.alignmentScores.length,
            count: stats.alignmentScores.length,
        };
    }

    // Remove raw statistics arrays to keep data clean
    delete analysis.statistics;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Analyze runway activity patterns
 * @private
 */
function analyzeRunwayActivity(analysis, aircraftList) {
    Object.values(analysis.runways).forEach((runway) => {
        if (runway.aircraft.length === 0) return;

        // Calculate runway statistics
        const alignmentScores = runway.aircraft.map((a) => a.alignmentScore);
        runway.statistics = {
            aircraftCount: runway.aircraft.length,
            averageAlignment: alignmentScores.reduce((a, b) => a + b, 0) / alignmentScores.length,
            minAlignment: Math.min(...alignmentScores),
            maxAlignment: Math.max(...alignmentScores),
        };

        // Determine runway status
        runway.status = determineRunwayStatus(runway);

        // Determine primary usage
        runway.primaryUse = determineRunwayUsage(runway.phases);
    });

    // Identify most active runway
    analysis.activeRunways = identifyActiveRunways(analysis.runways);

    // Initialize tracking arrays
    analysis.separationIssues = [];
    analysis.unusualPatterns = [];
    analysis.weatherImpact = {
        holding: 0,
        deviations: 0,
        goArounds: 0,
    };

    // Track separation issues and other patterns
    aircraftList.forEach((aircraft) => {
        // Check if aircraft has airport data before trying to access it
        if (!aircraft.calculated?.airports_nearby?.airports) return;

        const airport = aircraft.calculated.airports_nearby.airports.find((apt) => apt.icao_code === analysis.icao_code);

        if (!airport) return;

        // Track wake separation issues
        if (airport.wakeSeparation && !airport.wakeSeparation.adequate) {
            analysis.separationIssues.push({
                aircraft: aircraft.flight || aircraft.hex,
                preceding: airport.wakeSeparation.precedingAircraft,
                separation: airport.wakeSeparation.separation,
                severity: airport.wakeSeparation.severity,
            });
        }

        // Track weather impact
        if (airport.weatherAvoidance) {
            analysis.weatherImpact.deviations++;
        }
        if (airport.phase === 'holding') {
            analysis.weatherImpact.holding++;
        }
        if (airport.phase === 'go_around' || airport.phase === 'missed_approach') {
            analysis.weatherImpact.goArounds++;
        }

        // Track unusual patterns
        if (airport.phase === 'weather_avoidance') {
            analysis.unusualPatterns.push({
                type: 'weather_avoidance',
                aircraft: aircraft.flight || aircraft.hex,
                patterns: airport.weatherAvoidance.patterns,
            });
        }
    });
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Determine if runway is likely active
 * @private
 */
function determineRunwayStatus(runway) {
    const hasMinimumTraffic = runway.aircraft.length >= 2;
    const hasGoodAlignment = runway.statistics.averageAlignment > 0.6;
    const hasOperations = runway.phases.approaching > 0 || runway.phases.departing > 0;

    if (hasMinimumTraffic && hasGoodAlignment && hasOperations) {
        return 'active';
    } else if (runway.aircraft.length > 0 && hasGoodAlignment) {
        return 'possible';
    } else {
        return 'inactive';
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Determine primary runway usage
 * @private
 */
function determineRunwayUsage(phases) {
    if (phases.approaching > phases.departing * 1.5) {
        return 'landing';
    } else if (phases.departing > phases.approaching * 1.5) {
        return 'takeoff';
    } else if (phases.approaching > 0 || phases.departing > 0) {
        return 'mixed';
    } else {
        return 'unknown';
    }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Identify active runways
 * @private
 */
function identifyActiveRunways(runways) {
    return Object.values(runways)
        .filter((r) => r.status === 'active')
        .sort((a, b) => b.aircraft.length - a.aircraft.length)
        .map((r) => ({
            name: r.name,
            aircraftCount: r.aircraft.length,
            primaryUse: r.primaryUse,
            averageAlignment: r.statistics.averageAlignment,
        }));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Generate alertable insights from airport analysis
 * @param {Object} analysis - Airport analysis data
 * @returns {Array} Array of insight objects
 */
function generateAirportInsights(analysis) {
    const insights = [];

    // High traffic volume
    if (analysis.aircraft.total >= 10) {
        insights.push({
            type: 'high_traffic',
            severity: 'info',
            airport: analysis.icao_code,
            message: `High traffic volume: ${analysis.aircraft.total} aircraft`,
            data: {
                total: analysis.aircraft.total,
                breakdown: { ...analysis.aircraft },
            },
        });
    }

    // Active runway detection
    if (analysis.activeRunways.length > 0) {
        const [primary] = analysis.activeRunways;
        insights.push({
            type: 'active_runway',
            severity: 'info',
            airport: analysis.icao_code,
            message: `Active runway ${primary.name} detected (${primary.primaryUse})`,
            data: {
                runway: primary.name,
                usage: primary.primaryUse,
                aircraftCount: primary.aircraftCount,
                alignment: Math.round(primary.averageAlignment * 100),
            },
        });
    }

    // Multiple active runways (possible parallel operations)
    if (analysis.activeRunways.length > 1) {
        insights.push({
            type: 'parallel_operations',
            severity: 'info',
            airport: analysis.icao_code,
            message: `Multiple active runways detected`,
            data: {
                runways: analysis.activeRunways.map((r) => r.name),
                count: analysis.activeRunways.length,
            },
        });
    }

    // Ground congestion
    if (analysis.aircraft.ground >= 5) {
        insights.push({
            type: 'ground_congestion',
            severity: 'warning',
            airport: analysis.icao_code,
            message: `High ground traffic: ${analysis.aircraft.ground} aircraft`,
            data: {
                groundCount: analysis.aircraft.ground,
                percentage: Math.round((analysis.aircraft.ground / analysis.aircraft.total) * 100),
            },
        });
    }

    // Unusual patterns
    if (analysis.aircraft.approaching > 0 && analysis.aircraft.departing > 0 && analysis.activeRunways.length === 1) {
        insights.push({
            type: 'mixed_operations',
            severity: 'info',
            airport: analysis.icao_code,
            message: `Mixed operations on single runway`,
            data: {
                runway: analysis.activeRunways[0]?.name,
                approaching: analysis.aircraft.approaching,
                departing: analysis.aircraft.departing,
            },
        });
    }

    // Unstable approach detection
    const unstableApproaches = analysis.runways ? Object.values(analysis.runways).flatMap((runway) => runway.aircraft.filter((a) => a.phase === 'approaching' && a.speed && (a.speed < 100 || a.speed > 180))) : [];

    if (unstableApproaches.length > 0) {
        insights.push({
            type: 'unstable_approaches',
            severity: 'warning',
            airport: analysis.icao_code,
            message: `${unstableApproaches.length} unstable approach${unstableApproaches.length > 1 ? 'es' : ''} detected`,
            data: {
                aircraft: unstableApproaches.map((a) => ({
                    flight: a.flight,
                    speed: a.speed,
                    altitude: a.altitude,
                })),
            },
        });
    }

    // Separation alerts
    if (analysis.separationIssues && analysis.separationIssues.length > 0) {
        insights.push({
            type: 'separation_alert',
            severity: 'warning',
            airport: analysis.icao_code,
            message: `Wake turbulence separation issues detected`,
            data: {
                count: analysis.separationIssues.length,
                issues: analysis.separationIssues,
            },
        });
    }

    // Unusual pattern alerts
    if (analysis.unusualPatterns && analysis.unusualPatterns.length > 0) {
        analysis.unusualPatterns.forEach((pattern) => {
            insights.push({
                type: 'unusual_pattern',
                severity: 'info',
                airport: analysis.icao_code,
                message: `Unusual pattern: ${pattern.type}`,
                data: pattern,
            });
        });
    }

    // Training activity
    const trainingActivity = analysis.runways ? Object.values(analysis.runways).reduce((sum, runway) => sum + runway.aircraft.filter((a) => a.phase === 'pattern' || a.phase === 'touch_and_go').length, 0) : 0;

    if (trainingActivity >= 3) {
        insights.push({
            type: 'training_activity',
            severity: 'info',
            airport: analysis.icao_code,
            message: `High training activity: ${trainingActivity} aircraft`,
            data: {
                count: trainingActivity,
                types: ['pattern', 'touch_and_go'],
            },
        });
    }

    // Weather impact
    if (analysis.weatherImpact && (analysis.weatherImpact.holding > 0 || analysis.weatherImpact.deviations > 0 || analysis.weatherImpact.goArounds > 0)) {
        insights.push({
            type: 'weather_impact',
            severity: 'warning',
            airport: analysis.icao_code,
            message: `Weather affecting operations (${analysis.weatherImpact.holding} holding, ${analysis.weatherImpact.deviations} deviations, ${analysis.weatherImpact.goArounds} goArounds}`,
            data: {
                holdingCount: analysis.weatherImpact.holding,
                deviations: analysis.weatherImpact.deviations,
                goArounds: analysis.weatherImpact.goArounds,
            },
        });
    }

    return insights;
}

/**
 * Format insights for console output
 * @param {Array} insights - Array of insight objects
 * @returns {Array} Formatted strings for console
 */
function formatInsightsForConsole(insights) {
    const grouped = {};

    // Group by airport
    insights.forEach((insight) => {
        if (!grouped[insight.airport]) {
            grouped[insight.airport] = [];
        }
        grouped[insight.airport].push(insight);
    });

    const output = [];
    Object.entries(grouped).forEach(([airport, airportInsights]) => {
        output.push(`\n${airport}:`);
        airportInsights.forEach((insight) => {
            const icon = insight.severity === 'warning' ? '⚠️ ' : '✓ ';
            output.push(`  ${icon}${insight.message}`);

            // Add relevant data details
            if (insight.type === 'active_runway') {
                output.push(`     ${insight.data.aircraftCount} aircraft, ${insight.data.alignment}% avg alignment`);
            } else if (insight.type === 'high_traffic') {
                const { breakdown } = insight.data;
                output.push(`     Ground: ${breakdown.ground}, Approaching: ${breakdown.approaching}, Departing: ${breakdown.departing}`);
            }
        });
    });
    return output;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    id: 'airport',
    name: 'Aircraft near airport',
    priority: 5,
    config: (conf, extra) => {
        this.conf = conf || {};
        this.extra = extra;
        // Configuration for priority airports (always alert even if small)
        this.conf.priorities = this.conf.priorities || ['EGLL', 'EGKK', 'EGLC', 'EGSS'];
        // Minimum distance to consider (km)
        this.conf.minDistance = this.conf.minDistance || 0.5;
        // Runway alignment confidence threshold
        this.conf.runwayAlignmentThreshold = this.conf.runwayAlignmentThreshold || 0.7;
        // Distance for runway alignment detection (km)
        // Default varies by aircraft category, but can be overridden
        this.conf.runwayAlignmentDistance = this.conf.runwayAlignmentDistance || {
            default: 20, // 20km (~11nm) default
            A1: 10, // Light aircraft shorter approach
            A2: 15, // Small aircraft
            A3: 25, // Large aircraft longer approach
            A4: 25, // B757
            A5: 30, // Heavy aircraft longest approach
            A7: 5, // Helicopters very short
        };
        console.error(`filter-airport: configured`); //XXX improve
    },
    preprocess: (aircraft, { aircraftData, aircraftList }) => {
        aircraft.calculated.airports_nearby = { hasAirportsNearby: false };
        const airports_nearby = detectAirportsNearby(this.conf, this.extra, aircraft, aircraftData, aircraftList);
        if (airports_nearby) aircraft.calculated.airports_nearby = airports_nearby;
    },
    postprocess: ({ aircraftList }) => {
        // Only analyze if we have priority airports configured
        if (!this.conf.priorities || this.conf.priorities.length === 0) return;

        // Analyze each priority airport
        const analyses = this.conf.priorities.map((icaoCode) => analyzeAirportTraffic(icaoCode, aircraftList));

        // Filter out airports with no traffic
        const activeAnalyses = analyses.filter((a) => a.aircraft.total > 0);

        if (activeAnalyses.length === 0) return;

        // Generate insights from analyses
        const allInsights = activeAnalyses.flatMap((analysis) => generateAirportInsights(analysis));

        if (!this.historicalAnalysis) {
            this.historicalAnalysis = {};
        }

        // After analyzing each airport
        activeAnalyses.forEach((analysis) => {
            const icao = analysis.icao_code;

            // Initialize history for this airport if needed
            if (!this.historicalAnalysis[icao]) {
                this.historicalAnalysis[icao] = [];
            }

            // Detect runway changes
            const runwayChange = detectors.detectRunwayChange(this.historicalAnalysis[icao], analysis);

            if (runwayChange?.detected) {
                // Add to insights
                allInsights.push({
                    type: 'runway_change',
                    severity: 'warning',
                    airport: icao,
                    message: `Runway change detected: ${runwayChange.previousRunway} → ${runwayChange.currentRunway}`,
                    data: runwayChange,
                });
            }

            // Store current analysis in history (keep last 20 entries)
            this.historicalAnalysis[icao].push({
                timestamp: analysis.timestamp,
                activeRunways: analysis.activeRunways,
            });

            if (this.historicalAnalysis[icao].length > 20) {
                this.historicalAnalysis[icao].shift();
            }
        });

        // Store the analysis results for potential future use
        this.lastAnalysis = {
            timestamp: new Date().toISOString(),
            airports: activeAnalyses,
            insights: allInsights,
        };

        // For now, output to console
        if (allInsights.length > 0) formatInsightsForConsole(allInsights).forEach((line) => console.error(line));

        // Return structured data for future use
        // return this.lastAnalysis;
    },
    evaluate: (aircraft) => aircraft.calculated.airports_nearby.hasAirportsNearby,
    sort: (a, b) => {
        const a_ = a.calculated.airports_nearby;
        const b_ = b.calculated.airports_nearby;

        // Sort by best match relevance score
        const aScore = a_.bestMatch?.relevanceScore || 0;
        const bScore = b_.bestMatch?.relevanceScore || 0;
        return bScore - aScore;
    },
    getStats: (aircrafts, list) => {
        // Group by airport
        const byAirport = {};
        list.forEach((aircraft) => {
            const airport = aircraft.calculated.airports_nearby.bestMatch;
            if (airport) {
                const key = airport.icao_code || airport.name;
                byAirport[key] = (byAirport[key] || 0) + 1;
            }
        });

        // Count phases
        const phases = { approaching: 0, departing: 0, ground_operations: 0, other: 0 };
        list.forEach((aircraft) => {
            const phase = aircraft.calculated.airports_nearby.bestMatch?.phase || 'other';
            phases[phase]++;
        });

        // Runway alignment statistics
        const withGoodAlignment = list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.alignedRunway?.isGoodAlignment)).length;
        const withAnyAlignment = list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.alignedRunway)).length;

        const specialSituations = {
            goArounds: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.phase === 'go_around')).length,
            holding: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.holdingPattern)).length,
        };

        // Airport congestion metrics
        const congestionByAirport = {};
        list.forEach((aircraft) => {
            const airport = aircraft.calculated.airports_nearby.bestMatch;
            if (airport?.queueInfo) {
                const icao = airport.icao_code;
                if (!congestionByAirport[icao]) {
                    congestionByAirport[icao] = {
                        approaching: 0,
                        departing: 0,
                        maxQueue: 0,
                    };
                }
                congestionByAirport[icao].approaching = Math.max(congestionByAirport[icao].approaching, airport.queueInfo.approachingCount);
                congestionByAirport[icao].departing = Math.max(congestionByAirport[icao].departing, airport.queueInfo.departingCount);
            }
        });

        // Count advanced detection types
        const advancedDetections = {
            missedApproaches: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.phase === 'missed_approach')).length,
            ilsApproaches: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.approachType?.type === 'ILS')).length,
            visualApproaches: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.approachType?.type === 'visual')).length,
            wakeSeparationIssues: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.wakeSeparation && !apt.wakeSeparation.adequate)).length,
            weatherAvoidance: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.weatherAvoidance)).length,
        };

        // Training metrics
        const trainingMetrics = {
            totalPatternTime: list.reduce((sum, a) => {
                const pattern = a.calculated.airports_nearby.airports.find((apt) => apt.pattern?.duration);
                return sum + (pattern?.pattern.duration || 0);
            }, 0),
            touchAndGos: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.phase === 'touch_and_go')).length,
            patternsFlown: list.filter((a) => a.calculated.airports_nearby.airports.some((apt) => apt.phase === 'pattern')).length,
        };

        return {
            byAirport,
            phases,
            runwayAlignment: {
                good: withGoodAlignment,
                any: withAnyAlignment,
                none: list.length - withAnyAlignment,
            },
            specialSituations,
            congestion: congestionByAirport,
            advancedDetections,
            trainingMetrics,
        };
    },
    format: (aircraft) => {
        const { airports_nearby } = aircraft.calculated;

        const airportsFormat = tools.buildAirportsFormat(airports_nearby.airports, {
            maxAirports: 3,
            sortBy: 'relevanceScore',
            includeDistance: true,
            includeRunway: true,
            includePhase: true,
            includeConfidence: true,
        });

        const primaryAirport = airportsFormat.summary.primary;

        // Start with the default formatted text
        let { text, airports, summary } = airportsFormat;
        let warn = false;

        if (primaryAirport) {
            const { phase, distance, alignedRunway, pattern, altitude, queueInfo, icao_code, holdingPattern, missedApproach, approachType, wakeSeparation, runwayOccupancyTime } = primaryAirport;

            // Check standard warning conditions
            warn = this.conf.priorities?.includes(icao_code) || phase === 'approaching' || (distance && distance < this.conf.minDistance) || alignedRunway?.confidenceScore > this.conf.runwayAlignmentThreshold;

            // Handle special phases that need custom formatting
            const airportStr = tools.formatAirport(primaryAirport) || 'airport';

            switch (phase) {
                case 'go_around':
                    text = `GO-AROUND at ${airportStr}`;
                    warn = true;
                    break;
                case 'missed_approach':
                    text = `MISSED APPROACH at ${airportStr}`;
                    if (missedApproach) {
                        text += ` from ${Math.round(missedApproach.decisionAltitude)}ft`;
                    }
                    warn = true;
                    break;
                case 'holding':
                    text = `holding near ${airportStr}`;
                    if (holdingPattern) text += ` for ${Math.round(holdingPattern.duration / 60)}min`;
                    break;
                case 'pattern':
                    text = `in ${pattern?.direction || ''} pattern at ${airportStr}`;
                    if (pattern?.turnCount) text += ` (${pattern.turnCount} turns)`;
                    if (pattern?.duration) text += ` for ${Math.round(pattern.duration / 60)}min`;
                    break;
                case 'overhead_join':
                    text = `overhead join at ${airportStr}`;
                    text += ` @ ${Math.round(altitude)}ft`;
                    break;
                case 'touch_and_go':
                    text = `touch-and-go at ${airportStr}`;
                    warn = true;
                    break;
                case 'weather_avoidance':
                    text = `weather avoidance near ${airportStr}`;
                    warn = true;
                    break;
            }

            // Add approach type for approaching aircraft
            if (phase === 'approaching' && approachType) {
                const approach = approachType;
                text = `${approach.type}${approach.category ? ' ' + approach.category : ''} approach to ${airportStr}`;
            }

            // Add approach speed indicator
            if ((phase === 'approaching' || phase === 'landing') && aircraft.gs) {
                const speedIndicator = aircraftInfo.getApproachSpeedIndicator(aircraft);
                if (speedIndicator !== 'normal') {
                    text += ` (${speedIndicator} approach)`;
                    if (speedIndicator === 'fast') warn = true;
                }
            }

            // Add wake turbulence warning if detected
            if (wakeSeparation && !wakeSeparation.adequate) {
                text += ` ⚠️ WAKE`;
                warn = true;
            }

            // Add runway occupancy time for departing aircraft
            if (phase === 'departing' && runwayOccupancyTime) {
                text += ` (${Math.round(runwayOccupancyTime)}s on runway)`;
            }

            // Add distance if not already included
            if (!text.includes('[') && distance) {
                text += ` [${distance.toFixed(1)}km]`;
            }

            // Add queue information if available
            if (queueInfo && queueInfo.queuePosition > 0) {
                text += ` (#${queueInfo.queuePosition + 1} in queue)`;
            }

            // Add additional airports count if not already included
            if (airports_nearby.airports.length > 1 && !text.includes('+')) {
                const additionalCount = airports_nearby.airports.length - 1;
                text += ` (+${additionalCount} other${additionalCount > 1 ? 's' : ''})`;
            }
        }

        return {
            text,
            warn,
            airports,
            airportsSummary: summary,
        };
    },
    debug: (type, aircraft) => {
        const { airports_nearby } = aircraft.calculated;
        if (type === 'sorting') {
            const best = airports_nearby.bestMatch;
            return (
                `airports=${airports_nearby.compatibleCount}/${airports_nearby.totalCount}, ` +
                `relevance=${best?.relevanceScore.toFixed(2)}, ` +
                `dist=${best?.distance.toFixed(1)}km` +
                (best?.alignedRunway ? `, runway=${best.alignedRunway.runwayName}` : '')
            );
        }
        return undefined;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------
