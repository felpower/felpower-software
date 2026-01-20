/**
 * Wiener Linien Real-time Monitor
 * Displays live departure information using Wiener Linien Open Data API
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        API_BASE_URL: 'https://www.wienerlinien.at/ogd_realtime/monitor',
        REFRESH_INTERVAL: 30000, // 30 seconds
        CORS_PROXY: 'https://api.allorigins.win/raw?url=', // CORS proxy for development
        MAX_DEPARTURES: 8 // Maximum number of departures to display
    };

    let refreshTimer = null;
    let currentRBLs = ['623', '592']; // Default: Allerheiligengasse both directions

    /**
     * Initialize the monitor
     */
    function init() {
        setupEventListeners();
        loadDepartures();
        
        // Auto-refresh every 30 seconds
        refreshTimer = setInterval(loadDepartures, CONFIG.REFRESH_INTERVAL);
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        const stationSelect = document.getElementById('station-select');
        const customRBL = document.getElementById('custom-rbl');

        stationSelect.addEventListener('change', function() {
            if (this.value === 'custom') {
                customRBL.style.display = 'inline-block';
                customRBL.focus();
            } else {
                customRBL.style.display = 'none';
                currentRBLs = this.value.split(',').map(rbl => rbl.trim());
                loadDepartures();
            }
        });

        customRBL.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && this.value.trim()) {
                currentRBLs = this.value.split(',').map(rbl => rbl.trim());
                loadDepartures();
            }
        });
    }

    /**
     * Load departures from API
     */
    function loadDepartures() {
        showLoading();
        clearError();

        // Fetch data from all RBL numbers
        const fetchPromises = currentRBLs.map(rbl => {
            const apiUrl = `${CONFIG.API_BASE_URL}?rbl=${rbl}&activateTrafficInfo=stoerunglang`;
            const url = CONFIG.CORS_PROXY + encodeURIComponent(apiUrl);
            
            return fetch(url)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .catch(error => {
                    console.error(`Error fetching departures for RBL ${rbl}:`, error);
                    return null;
                });
        });

        Promise.all(fetchPromises)
            .then(results => {
                // Filter out failed requests
                const validResults = results.filter(data => data !== null);
                
                if (validResults.length === 0) {
                    throw new Error('All API requests failed');
                }

                console.log('API Responses:', validResults);
                
                // Merge all departures from all RBLs
                const mergedData = mergeAPIResponses(validResults);
                
                displayDepartures(mergedData);
                displayTrafficInfo(validResults[0]); // Use traffic info from first response
                updateLastUpdateTime();
            })
            .catch(error => {
                console.error('Error fetching departures:', error);
                showError('Fehler beim Laden der Abfahrtsdaten. Bitte versuchen Sie es später erneut.');
                showFallbackData();
            });
    }

    /**
     * Merge API responses from multiple RBL numbers
     */
    function mergeAPIResponses(responses) {
        const merged = {
            data: {
                monitors: [],
                trafficInfos: []
            }
        };

        responses.forEach(response => {
            if (response.data && response.data.monitors) {
                merged.data.monitors.push(...response.data.monitors);
            }
            if (response.data && response.data.trafficInfos) {
                merged.data.trafficInfos.push(...response.data.trafficInfos);
            }
        });

        return merged;
    }

    /**
     * Display departures in table
     */
    function displayDepartures(data) {
        const tbody = document.getElementById('departures-body');
        tbody.innerHTML = '';

        if (!data.data || !data.data.monitors || data.data.monitors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading">Keine Abfahrten gefunden für diese Station.</td></tr>';
            return;
        }

        const departures = [];
        
        // Extract all departures from all monitors
        data.data.monitors.forEach(monitor => {
            if (monitor.lines && monitor.lines.length > 0) {
                monitor.lines.forEach(line => {
                    if (line.departures && line.departures.departure) {
                        line.departures.departure.forEach(departure => {
                            departures.push({
                                line: line.name,
                                towards: line.towards,
                                lineType: line.type || 'ptBusCity',
                                barrierFree: line.barrierFree || false,
                                departureTime: departure.departureTime,
                                countdown: departure.departureTime.countdown
                            });
                        });
                    }
                });
            }
        });

        // Sort by countdown time
        departures.sort((a, b) => a.countdown - b.countdown);

        // Display only the next 4 departures
        departures.slice(0, CONFIG.MAX_DEPARTURES).forEach(dep => {
            const row = createDepartureRow(dep);
            tbody.appendChild(row);
        });

        if (departures.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading">Keine Abfahrten in den nächsten Minuten.</td></tr>';
        }
    }

    /**
     * Create a departure row
     */
    function createDepartureRow(departure) {
        const row = document.createElement('tr');
        
        // Line badge
        const lineCell = document.createElement('td');
        const lineBadge = document.createElement('span');
        lineBadge.className = `line-badge ${getLineClass(departure.lineType)}`;
        lineBadge.textContent = departure.line;
        lineCell.appendChild(lineBadge);
        row.appendChild(lineCell);

        // Direction
        const directionCell = document.createElement('td');
        directionCell.textContent = departure.towards;
        row.appendChild(directionCell);

        // Countdown
        const countdownCell = document.createElement('td');
        const countdownSpan = document.createElement('span');
        countdownSpan.className = 'countdown';
        
        if (departure.countdown === 0) {
            countdownSpan.className += ' countdown-now';
            countdownSpan.textContent = 'JETZT';
        } else if (departure.countdown === 1) {
            countdownSpan.textContent = '1 min';
        } else {
            countdownSpan.textContent = `${departure.countdown} min`;
        }
        
        countdownCell.appendChild(countdownSpan);
        row.appendChild(countdownCell);

        // Barrier-free
        const barrierCell = document.createElement('td');
        if (departure.barrierFree) {
            barrierCell.innerHTML = '<span class="barrier-free">♿ Ja</span>';
        } else {
            barrierCell.textContent = 'Nein';
        }
        row.appendChild(barrierCell);

        return row;
    }

    /**
     * Get CSS class for line type
     */
    function getLineClass(lineType) {
        if (lineType.includes('Bus')) return 'line-bus';
        if (lineType.includes('Tram')) return 'line-tram';
        if (lineType.includes('U')) return 'line-u';
        if (lineType.includes('S')) return 'line-s';
        return 'line-bus';
    }

    /**
     * Display traffic information
     */
    function displayTrafficInfo(data) {
        const container = document.getElementById('traffic-info-container');
        container.innerHTML = '';

        if (data.data && data.data.trafficInfos && data.data.trafficInfos.length > 0) {
            data.data.trafficInfos.forEach(info => {
                const div = document.createElement('div');
                div.className = 'traffic-info';
                div.innerHTML = `
                    <h3>⚠️ ${info.title || 'Verkehrsinformation'}</h3>
                    <p>${info.description || info.subtitle || 'Keine Details verfügbar'}</p>
                `;
                container.appendChild(div);
            });
        }
    }

    /**
     * Update last update time
     */
    function updateLastUpdateTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('de-AT');
        document.getElementById('last-update').textContent = `Letzte Aktualisierung: ${timeString}`;
    }

    /**
     * Show loading state
     */
    function showLoading() {
        const tbody = document.getElementById('departures-body');
        tbody.innerHTML = '<tr><td colspan="4" class="loading">Lade Daten...</td></tr>';
    }

    /**
     * Show error message
     */
    function showError(message) {
        const errorContainer = document.getElementById('error-container');
        errorContainer.innerHTML = `<div class="error">${message}</div>`;
    }

    /**
     * Clear error message
     */
    function clearError() {
        document.getElementById('error-container').innerHTML = '';
    }

    /**
     * Show fallback demo data
     */
    function showFallbackData() {
        const tbody = document.getElementById('departures-body');
        tbody.innerHTML = `
            <tr>
                <td><span class="line-badge line-u">U1</span></td>
                <td>Leopoldau</td>
                <td><span class="countdown">2 min</span></td>
                <td><span class="barrier-free">♿ Ja</span></td>
            </tr>
            <tr>
                <td><span class="line-badge line-u">U3</span></td>
                <td>Ottakring</td>
                <td><span class="countdown">5 min</span></td>
                <td><span class="barrier-free">♿ Ja</span></td>
            </tr>
            <tr>
                <td><span class="line-badge line-tram">2</span></td>
                <td>Dornbach</td>
                <td><span class="countdown">8 min</span></td>
                <td>Nein</td>
            </tr>
        `;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
