/* global config, airportsData */

$(document).ready(async function () {
    const homeLocation = config.location;
    const maxRadarRange = 75;
    const flightTrackingServices = [
        {
            id: 'flightaware',
            name: 'FLIGHTAWARE',
            links: [
                { title: 'Tracker (Online)', url: 'https://flightaware.com/skyaware' },
                { title: 'Status (Online)', url: `https://flightaware.com/adsb/stats/user/mgream/#stats-${config.services.flightaware?.site}` },
                { title: 'Tracker (Local)', url: 'skyaware' },
                { title: 'Status (Local)', url: 'flightaware.html' },
            ],
        },
        {
            id: 'flightradar24',
            name: 'FLIGHTRADAR24',
            links: [
                { title: 'Tracker (Online)', url: `https://www.flightradar24.com/${homeLocation.lat.toFixed(2)},${homeLocation.lon.toFixed(2)}/8` },
                { title: 'Status (Online)', url: `https://www.flightradar24.com/account/feed-stats/?id=${config.services.flightradar24?.id}` },
                { title: 'Tracker (Local)', url: window.location.protocol + '//' + window.location.hostname + ':8754/tracked.html' },
                { title: 'Status (Local)', url: window.location.protocol + '//' + window.location.hostname + ':8754/' },
            ],
        },
        {
            id: 'adsbexchange',
            name: 'ADSB-EXCHANGE',
            links: [
                { title: 'Tracker (Online)', url: 'https://globe.adsbexchange.com' },
                { title: 'Status (Online)', url: `https://www.adsbexchange.com/api/feeders/?feed=${config.services.adsbexchange?.uid}` },
                { title: 'Map (Online)', url: `https://globe.adsbexchange.com/?feed=${config.services.adsbexchange?.uid}` },
                { title: 'MLAT (Online)', url: `https://map.adsbexchange.com/sync/feeder.html?${config.services.adsbexchange?.region}&${config.services.adsbexchange?.name}` },
                { title: 'Tracker (Local)', url: 'adsbx' },
            ],
        },
        {
            id: 'airnavradar',
            name: 'AIRNAV.RADAR',
            links: [
                { title: 'Tracker (Online)', url: `https://www.airnavradar.com/@${homeLocation.lat},${homeLocation.lon},z8` },
                { title: 'Status (Online)', url: `https://www.airnavradar.com/stations/${config.services.airnavradar?.station}` },
            ],
        },
        {
            id: 'opensky',
            name: 'OPENSKY',
            links: [{ title: 'Tracker (Online)', url: 'https://map.opensky-network.org' }],
        },
    ];

    //

    var flightData = {};
    function fetchFlightData() {
        return $.ajax({ url: 'radar-data.php', type: 'GET', data: { type: 'flights' }, dataType: 'json', timeout: 5000, cache: false }).catch((e) => {
            console.error('Error fetching flight data:', e);
            return {};
        });
    }
    var logLines = [];
    function fetchLogData() {
        return $.ajax({ url: 'radar-data.php', type: 'GET', data: { type: 'logs' }, dataType: 'json', timeout: 5000, cache: false }).catch((e) => {
            console.error('Error fetching log data:', e);
            return [];
        });
    }

    //

    var flightHistory = {};
    var lastCleanTime = Date.now();
    const maxFlights = 50,
        maxHistory = 20,
        maxLength = 5,
        maxStorage = 4 * 1024 * 1024;
    function loadFlightHistory() {
        try {
            const savedHistory = localStorage.getItem('flightHistory');
            if (savedHistory) {
                flightHistory = JSON.parse(savedHistory);
                cleanFlightHistory();
            }
        } catch (e) {
            console.error('flightHistory: loading error:', e);
            flightHistory = {};
        }
    }
    function trimFlightHistory(size) {
        const codes = Object.keys(flightHistory);
        if (codes.length > size)
            codes
                .sort((a, b) => (flightHistory[b][0]?.timestamp || 0) - (flightHistory[a][0]?.timestamp || 0))
                .slice(size)
                .forEach((hexCode) => delete flightHistory[hexCode]);
    }
    function cleanFlightHistory() {
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;
        Object.keys(flightHistory)
            .filter((hexCode) => flightHistory[hexCode].length > 0 && flightHistory[hexCode][0].timestamp < oneHourAgo)
            .forEach((hexCode) => delete flightHistory[hexCode]);
        trimFlightHistory(maxFlights);
        lastCleanTime = now;
    }
    function saveFlightHistory() {
        try {
            if (JSON.stringify(flightHistory).length > maxStorage || Date.now() - lastCleanTime > 5 * 60 * 1000) cleanFlightHistory();
            if (JSON.stringify(flightHistory).length > maxStorage)
                Object.keys(flightHistory)
                    .filter((hexCode) => flightHistory[hexCode].length > maxLength)
                    .forEach((hexCode) => (flightHistory[hexCode] = flightHistory[hexCode].slice(0, maxLength)));
            if (JSON.stringify(flightHistory).length > maxStorage) trimFlightHistory(maxHistory);
            localStorage.setItem('flightHistory', JSON.stringify(flightHistory));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                console.error('flightHistory: storage quota exceeded, clearing');
                flightHistory = {};
                localStorage.removeItem('flightHistory');
                try {
                    localStorage.setItem('flightHistory', JSON.stringify(flightHistory));
                } catch (e) {
                    console.error('flightHistory: could not save after clearing:', e);
                }
            } else {
                console.error('flightHistory: saving error:', e);
            }
        }
    }

    //

    function displayInfo() {
        const html =
            flightTrackingServices
                .filter((service) => config.services?.[service.id])
                .map((service) => `<div class="info-section"><h3>${service.name}</h3>` + service.links.map((link) => `<a href="${link.url}" class="info-link" target="_blank">${link.title}</a>`).join('') + `</div>`)
                .join('') +
            `<div class="info-section">
            <h3>LOCATION</h3>
            <div>${homeLocation.address}</div>
            <div><a href="https://www.google.co.uk/maps/place/${homeLocation.lat},${homeLocation.lon}" class="info-link" target="_blank">(${homeLocation.lat.toFixed(6)}, ${homeLocation.lon.toFixed(6)}, ${homeLocation.alt}ft)</a></div>
        </div>`;
        $('.info-container').html(html);
    }

    function displayRadarHome() {
        const home = $('<div class="radar-home"></div>');
        $('.radar-container').append(home);
    }

    function displayRadarLabels() {
        [
            { class: 'c1', percent: 30, label: Math.round(maxRadarRange * (1 / 3)) + 'km' },
            { class: 'c2', percent: 60, label: Math.round(maxRadarRange * (2 / 3)) + 'km' },
            { class: 'c3', percent: 90, label: maxRadarRange + 'km' },
        ].forEach((circle) => {
            const labelX = 50 + (circle.percent / 2) * Math.sin((225 * Math.PI) / 180),
                labelY = 50 - (circle.percent / 2) * Math.cos((225 * Math.PI) / 180);
            const label = $('<div class="radar-circle-label"></div>');
            label.text(circle.label);
            label.css({ left: labelX + '%', top: labelY + '%' });
            $('.radar-container').append(label);
        });
    }

    function findAirportsInRange(centerLat, centerLon, maxRange) {
        return Object.fromEntries(
            Object.entries(airportsData).flatMap(([code, airport]) => {
                if (airport.type === 'closed') return [];
                const distance = calculateGeoDistance(centerLat, centerLon, airport.latitude_deg, airport.longitude_deg);
                return distance <= maxRange ? [[code, { ...airport, distance }]] : [];
            })
        );
    }
    const is_pad = (airport) => ['heliport', 'balloonport', 'seaplane_base'].includes(airport.type);
    function airportATZradius(airport) {
        if (is_pad(airport)) return 0.5;
        const runwayLengthMax = airport.runwayLengthMax || airport.runways.reduce((lengthMax, runway) => Math.max(runway.length_ft ? runway.length_ft * 0.3048 : 0, lengthMax), 0);
        return ((runwayLengthMax && runwayLengthMax < 1850) || airport.iata_code?.trim() === '' ? 2 : 2.5) * 1.852;
    }
    function airportATZaltitude(airport) {
        return airport.elevation_ft + (is_pad(airport) ? 1500 : 2000);
    }
    function isNearAirport(lat, lon, altitude) {
        return (
            altitude < 2000 &&
            Object.entries(findAirportsInRange(homeLocation.lat, homeLocation.lon, maxRadarRange)).some(
                ([_, airport]) => calculateGeoDistance(lat, lon, airport.latitude_deg, airport.longitude_deg) <= airportATZradius(airport) && altitude < airportATZaltitude(airport)
            )
        );
    }
    function displayRadarAirports() {
        Object.entries(findAirportsInRange(homeLocation.lat, homeLocation.lon, maxRadarRange)).forEach(([code, airport]) => {
            const { distance } = airport,
                bearing = calculateGeoAngle(homeLocation.lat, homeLocation.lon, airport.latitude_deg, airport.longitude_deg); // eslint-disable-line unicorn/consistent-destructuring
            const radarX = 50 + (distance / maxRadarRange) * 45 * Math.sin((bearing * Math.PI) / 180),
                radarY = 50 - (distance / maxRadarRange) * 45 * Math.cos((bearing * Math.PI) / 180);
            const marker = $('<div class="airport-marker"></div>');
            marker.css({ left: radarX + '%', top: radarY + '%' });
            $('.radar-container').append(marker);
            const label = $('<div class="airport-label"></div>');
            label.text(`${code} (${airport.name})`);
            label.css({ left: radarX + 0.5 + '%', top: radarY - 0.5 + '%' });
            $('.radar-container').append(label);
            const circleRadiusPercent = (airportATZradius(airport) / maxRadarRange) * 45;
            const circle = $('<div class="airport-circle"></div>');
            circle.css({
                left: radarX - circleRadiusPercent + '%',
                top: radarY - circleRadiusPercent + '%',
                width: circleRadiusPercent * 2 + '%',
                height: circleRadiusPercent * 2 + '%',
            });
            $('.radar-container').append(circle);
        });
    }

    function findIntersection(x1, y1, x2, y2, centerX, centerY, radius) {
        const dx = x2 - x1,
            dy = y2 - y1;
        const a = dx * dx + dy * dy;
        const b = 2 * (dx * (x1 - centerX) + dy * (y1 - centerY));
        const c = (x1 - centerX) * (x1 - centerX) + (y1 - centerY) * (y1 - centerY) - radius * radius;
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return undefined;
        const t1 = (-b + Math.sqrt(discriminant)) / (2 * a),
            t2 = (-b - Math.sqrt(discriminant)) / (2 * a);
        let t;
        if (t1 >= 0 && t1 <= 1) t = t1;
        else if (t2 >= 0 && t2 <= 1) t = t2;
        else return undefined;
        return {
            x: x1 + t * dx,
            y: y1 + t * dy,
        };
    }
    function calculatePointDistance(x1, y1, x2, y2) {
        return Math.hypot((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }
    function calculatePointAngle(x1, y1, x2, y2) {
        return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    }
    function calculateGeoDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180,
            dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    function calculateGeoAngle(lat1, lon1, lat2, lon2) {
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
        const x = Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) - Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon);
        const brng = (Math.atan2(y, x) * 180) / Math.PI;
        return (brng + 360) % 360;
    }
    function displayRadarFlights() {
        $('.radar-blip, .flight-info, .trail-point, .trail-line').remove();

        loadFlightHistory();
        if (!flightData || Object.keys(flightData).length === 0) return;
        let visibleFlights = [];
        let minDistance = Infinity,
            maxDistance = 0,
            maxAltitude = 0,
            minAltitude = Infinity;
        let altitudeCounts = {
            low: 0, // 0-2500 feet
            medium: 0, // 2500-8000 feet
            high: 0, // 8000-22000 feet
            veryHigh: 0, // >22000 feet
        };
        const updateTime = Date.now();
        Object.entries(flightData)
            .filter(([_, flight]) => flight && Array.isArray(flight) && flight.length >= 17)
            .forEach(([hexCode, flight]) => {
                const lat = Number.parseFloat(flight[1]),
                    lon = Number.parseFloat(flight[2]);
                if (!Number.isNaN(lat) && !Number.isNaN(lon) && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
                    const distance = calculateGeoDistance(homeLocation.lat, homeLocation.lon, lat, lon),
                        bearing = calculateGeoAngle(homeLocation.lat, homeLocation.lon, lat, lon);
                    const altitude = flight[4] ? Number.parseInt(flight[4]) : 0;
                    const callsign = flight[16] || hexCode,
                        squawk = flight[6] || '';
                    if (altitude <= 2500) altitudeCounts.low++;
                    else if (altitude <= 8000) altitudeCounts.medium++;
                    else if (altitude <= 22000) altitudeCounts.high++;
                    else altitudeCounts.veryHigh++;
                    const radarX = 50 + (distance / maxRadarRange) * 45 * Math.sin((bearing * Math.PI) / 180),
                        radarY = 50 - (distance / maxRadarRange) * 45 * Math.cos((bearing * Math.PI) / 180);
                    const isInATZ = isNearAirport(lat, lon, altitude);
                    if (!flightHistory[hexCode]) flightHistory[hexCode] = [];
                    flightHistory[hexCode].unshift({ timestamp: updateTime, lat, lon, distance, bearing, altitude, radarX, radarY, isInATZ });
                    if (flightHistory[hexCode].length > 10) flightHistory[hexCode] = flightHistory[hexCode].slice(0, 10);
                    if (distance <= maxRadarRange) visibleFlights.push({ hexCode, lat, lon, distance, bearing, callsign, altitude, squawk, radarX, radarY, isInATZ });
                    if (distance > maxDistance) maxDistance = distance;
                    if (distance < minDistance) minDistance = distance;
                    if (altitude > maxAltitude) maxAltitude = altitude;
                    if (altitude < minAltitude) minAltitude = altitude;
                }
            });
        saveFlightHistory();

        visibleFlights.sort((a, b) => a.distance - b.distance);
        const flightsTotal = Object.keys(flightData).length,
            flightsRadar = visibleFlights.length;
        Object.entries(flightHistory)
            .filter(([_, history]) => history.length >= 2)
            .forEach(([_, history]) => {
                for (let i = 1; i < history.length; i++) {
                    const pos = history[i],
                        prevPos = history[i - 1];
                    if (pos.distance > maxRadarRange && prevPos.distance > maxRadarRange) continue;
                    if (updateTime - pos.timestamp > 5 * 60 * 1000) continue;
                    const opacity = Math.max(0.1, 1 - i * 0.1);
                    if (pos.distance <= maxRadarRange) {
                        const point = $('<div class="trail-point"></div>');
                        const colour = `${pos.isInATZ ? '255, 0, 0' : '51, 255, 51'}`;
                        point.css({
                            left: pos.radarX + '%',
                            top: pos.radarY + '%',
                            'background-color': `rgba(${colour}, ${opacity})`,
                            'box-shadow': `0 0 ${4 * opacity}px rgba(${colour}, ${opacity})`,
                            'z-index': 90 - i,
                        });
                        $('.radar-container').append(point);
                    }
                    let x1 = pos.radarX,
                        y1 = pos.radarY,
                        x2 = prevPos.radarX,
                        y2 = prevPos.radarY;
                    if (pos.distance > maxRadarRange) {
                        const intersection = findIntersection(x1, y1, x2, y2, 50, 50, 45);
                        if (intersection) (x1 = intersection.x), (y1 = intersection.y);
                        else continue;
                    }
                    if (prevPos.distance > maxRadarRange) {
                        // eslint-disable-next-line sonarjs/arguments-order
                        const intersection = findIntersection(x2, y2, x1, y1, 50, 50, 45);
                        if (intersection) (x2 = intersection.x), (y2 = intersection.y);
                        else continue;
                    }
                    const lineLength = calculatePointDistance(x1, y1, x2, y2),
                        lineAngle = calculatePointAngle(x1, y1, x2, y2);
                    const line = $('<div class="trail-line"></div>');
                    const colourClass = pos.isInATZ || prevPos.isInATZ ? 'trail-line-atz' : 'trail-line-normal';
                    line.css({
                        left: x1 + '%',
                        top: y1 + '%',
                        width: lineLength + '%',
                        transform: `rotate(${lineAngle}deg)`,
                        opacity,
                        'z-index': 85 - i,
                    }).addClass(colourClass);
                    $('.radar-container').append(line);
                }
            });
        visibleFlights.forEach((flight, index) => {
            const blip = $('<div class="radar-blip"></div>');
            blip.css({ left: flight.radarX + '%', top: flight.radarY + '%', 'z-index': 100 + index });
            if (flight.isInATZ) blip.css({ 'background-color': '#ff0000', 'box-shadow': '0 0 8px #ff0000' });
            $('.radar-container').append(blip);
            const info = $('<div class="flight-info"></div>');
            info.html(flight.callsign + (flight.squawk ? ' (' + flight.squawk + ')' : '') + '<br>' + (flight.altitude > 0 ? flight.altitude : '- ') + 'ft ' + flight.distance.toFixed(1) + 'km');
            info.css({ left: flight.radarX + 0.5 + '%', top: flight.radarY + 1 + '%', 'z-index': 200 + index });
            if (flight.isInATZ) info.css('color', '#ff9999');
            $('.radar-container').append(info);
        });

        $('.flights-total').text(flightsTotal);
        $('.flights-range-local').text(flightsRadar + ` (${maxRadarRange}km)`);
        $('.flights-range-min').text(`${Math.floor(minDistance)}km`);
        $('.flights-range-max').text(`${Math.floor(maxDistance)}km`);
        $('.alt-low').text(altitudeCounts.low);
        $('.alt-medium').text(altitudeCounts.medium);
        $('.alt-high').text(altitudeCounts.high);
        $('.alt-very-high').text(altitudeCounts.veryHigh);
        $('.alt-min').text(minAltitude + 'ft');
        $('.alt-max').text(maxAltitude + 'ft');
        $('.stat-timestamp-value').text(new Date().toLocaleString());
    }

    function displayLogs() {
        if (logLines?.length > 0) $('.log-container').html(logLines.map((line) => `<div class="log-line">${line}</div>`).join(''));
    }

    //

    function updateData() {
        Promise.all([fetchFlightData(), fetchLogData()]).then(([flightDataNew, logLinesNew]) => {
            flightData = flightDataNew;
            logLines = logLinesNew;
            displayRadarFlights();
            displayLogs();
        });
    }

    //

    $('.radar-container').css({ bottom: `${config.radar?.bottom === undefined ? -80 : config.radar.bottom}vh`, right: `${config.radar?.right === undefined ? -20 : config.radar.right}vw` });
    displayInfo();
    displayRadarHome();
    displayRadarLabels();
    displayRadarAirports();
    displayRadarFlights();

    updateData();
    setInterval(updateData, 30000);
});
