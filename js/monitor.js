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
        MAX_DEPARTURES: 8, // Maximum number of departures to display
        WEATHER_API_URL: 'https://api.open-meteo.com/v1/forecast',
        VIENNA_LAT: 48.2082,
        VIENNA_LON: 16.3738,
        // Wien Energie Smart Meter API
        SMARTMETER_API_URL: 'https://api.wstw.at/gateway/WN_SMART_METER_API/1.0',
        SMARTMETER_PROXY: 'inc/smartmeter-proxy.php' // Backend proxy for secure API access
    };

    let refreshTimer = null;
    let currentRBLs = ['623', '592']; // Default: Allerheiligengasse both directions

    /**
     * Initialize the monitor
     */
    function init() {
        setupEventListeners();
        loadDepartures();
        loadWeather();
        loadSmartMeterData();
        
        // Auto-refresh every 30 seconds
        refreshTimer = setInterval(loadDepartures, CONFIG.REFRESH_INTERVAL);
        // Refresh weather every 10 minutes
        setInterval(loadWeather, 600000);
        // Refresh smart meter data every 30 minutes
        setInterval(loadSmartMeterData, 1800000);
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        const stationSelect = document.getElementById('station-select');
        const customRBL = document.getElementById('custom-rbl');
        const smartmeterWidget = document.getElementById('smartmeter-widget');
        const configModal = document.getElementById('config-modal');
        const saveConfig = document.getElementById('save-config');
        const cancelConfig = document.getElementById('cancel-config');
        const clearConfig = document.getElementById('clear-config');

        // Smart meter configuration
        smartmeterWidget.addEventListener('click', function() {
            openConfigModal();
        });

        saveConfig.addEventListener('click', function() {
            saveSmartMeterConfig();
        });

        cancelConfig.addEventListener('click', function() {
            configModal.classList.remove('active');
        });

        clearConfig.addEventListener('click', function() {
            clearSmartMeterConfig();
        });

        configModal.addEventListener('click', function(e) {
            if (e.target === configModal) {
                configModal.classList.remove('active');
            }
        });

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
     * Load weather data from Open-Meteo API (free, no API key required)
     */
    function loadWeather() {
        const url = `${CONFIG.WEATHER_API_URL}?latitude=${CONFIG.VIENNA_LAT}&longitude=${CONFIG.VIENNA_LON}&current=temperature_2m,weather_code&timezone=Europe/Vienna`;
        
        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (data.current) {
                    displayWeather(data.current);
                }
            })
            .catch(error => {
                console.error('Error fetching weather:', error);
                document.getElementById('weather-desc').textContent = 'Wetter nicht verfügbar';
            });
    }

    /**
     * Display weather information
     */
    function displayWeather(current) {
        const temp = Math.round(current.temperature_2m);
        const weatherCode = current.weather_code;
        
        document.getElementById('weather-temp').textContent = `${temp}°C`;
        
        // Weather code to description and icon mapping (WMO Weather interpretation codes)
        const weatherInfo = getWeatherInfo(weatherCode);
        document.getElementById('weather-icon').textContent = weatherInfo.icon;
        document.getElementById('weather-desc').textContent = weatherInfo.description;
    }

    /**
     * Get weather icon and description from WMO code
     */
    function getWeatherInfo(code) {
        const weatherMap = {
            0: { icon: '☀️', description: 'Klar' },
            1: { icon: '🌤️', description: 'Überwiegend klar' },
            2: { icon: '⛅', description: 'Teilweise bewölkt' },
            3: { icon: '☁️', description: 'Bewölkt' },
            45: { icon: '🌫️', description: 'Neblig' },
            48: { icon: '🌫️', description: 'Neblig' },
            51: { icon: '🌦️', description: 'Leichter Nieselregen' },
            53: { icon: '🌦️', description: 'Nieselregen' },
            55: { icon: '🌧️', description: 'Starker Nieselregen' },
            61: { icon: '🌧️', description: 'Leichter Regen' },
            63: { icon: '🌧️', description: 'Regen' },
            65: { icon: '🌧️', description: 'Starker Regen' },
            71: { icon: '🌨️', description: 'Leichter Schneefall' },
            73: { icon: '🌨️', description: 'Schneefall' },
            75: { icon: '🌨️', description: 'Starker Schneefall' },
            77: { icon: '🌨️', description: 'Schneegriesel' },
            80: { icon: '🌦️', description: 'Leichte Schauer' },
            81: { icon: '🌧️', description: 'Schauer' },
            82: { icon: '⛈️', description: 'Starke Schauer' },
            85: { icon: '🌨️', description: 'Leichte Schneeschauer' },
            86: { icon: '🌨️', description: 'Schneeschauer' },
            95: { icon: '⛈️', description: 'Gewitter' },
            96: { icon: '⛈️', description: 'Gewitter mit Hagel' },
            99: { icon: '⛈️', description: 'Starkes Gewitter' }
        };
        
        return weatherMap[code] || { icon: '🌡️', description: 'Unbekannt' };
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

    /**
     * Load smart meter data
     */
    function loadSmartMeterData() {
        const credentials = getSmartMeterCredentials();
        
        if (!credentials) {
            document.getElementById('smartmeter-value').textContent = '-- kWh';
            document.getElementById('smartmeter-period').textContent = 'Nicht konfiguriert';
            return;
        }

        document.getElementById('smartmeter-period').textContent = 'Lade...';
        
        // Check if backend proxy is available
        if (window.location.protocol === 'file:' || !isBackendAvailable()) {
            // Use demo data when running locally without backend
            setTimeout(() => {
                const mockConsumption = (Math.random() * 50 + 100).toFixed(1);
                displaySmartMeterData({
                    weeklyConsumption: mockConsumption,
                    period: 'Demo-Daten (Backend benötigt)',
                    unit: 'kWh'
                });
            }, 1000);
        } else {
            // Call backend proxy for secure API access
            fetchSmartMeterAPI(credentials);
        }
    }

    /**
     * Check if backend is available
     */
    function isBackendAvailable() {
        // Simple check - in production, you might want to ping the backend
        return document.location.hostname !== '' && 
               document.location.hostname !== 'localhost' &&
               !document.location.hostname.startsWith('127.0.0.1');
    }

    /**
     * Fetch smart meter data through backend proxy
     */
    function fetchSmartMeterAPI(credentials) {
        // Using backend proxy to handle authentication securely
        fetch(CONFIG.SMARTMETER_PROXY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                action: 'getConsumption',
                username: credentials.username,
                password: atob(credentials.password),
                meterId: credentials.meterId || '',
                period: 'week'
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                displaySmartMeterData(data.data);
            } else {
                throw new Error(data.error || 'API Fehler');
            }
        })
        .catch(error => {
            console.error('Smart meter API error:', error);
            document.getElementById('smartmeter-value').textContent = 'Fehler';
            document.getElementById('smartmeter-period').textContent = error.message;
            
            // Show configuration hint if authentication failed
            if (error.message.includes('401') || error.message.includes('Login')) {
                setTimeout(() => {
                    document.getElementById('smartmeter-period').textContent = 'Zugangsdaten prüfen';
                }, 2000);
            }
        });
    }

    /**
     * Display smart meter data
     */
    function displaySmartMeterData(data) {
        document.getElementById('smartmeter-value').textContent = `${data.weeklyConsumption} ${data.unit}`;
        document.getElementById('smartmeter-period').textContent = data.period;
    }

    /**
     * Open configuration modal
     */
    function openConfigModal() {
        const credentials = getSmartMeterCredentials();
        if (credentials) {
            document.getElementById('meter-username').value = credentials.username;
            document.getElementById('meter-id').value = credentials.meterId || '';
        }
        document.getElementById('config-modal').classList.add('active');
    }

    /**
     * Save smart meter configuration
     */
    function saveSmartMeterConfig() {
        const username = document.getElementById('meter-username').value.trim();
        const password = document.getElementById('meter-password').value;
        const meterId = document.getElementById('meter-id').value.trim();

        if (!username || !password) {
            alert('Bitte geben Sie Benutzername und Passwort ein.');
            return;
        }

        // Store credentials in localStorage (NOT recommended for production)
        // In production, send these to your backend and use secure token storage
        const credentials = {
            username: username,
            password: btoa(password), // Basic encoding (NOT encryption!)
            meterId: meterId
        };

        localStorage.setItem('smartmeter_config', JSON.stringify(credentials));
        document.getElementById('config-modal').classList.remove('active');
        
        // Clear password field
        document.getElementById('meter-password').value = '';
        
        loadSmartMeterData();
    }

    /**
     * Clear smart meter configuration
     */
    function clearSmartMeterConfig() {
        if (confirm('Möchten Sie die Smart Meter Konfiguration wirklich löschen?')) {
            localStorage.removeItem('smartmeter_config');
            document.getElementById('meter-username').value = '';
            document.getElementById('meter-password').value = '';
            document.getElementById('meter-id').value = '';
            document.getElementById('config-modal').classList.remove('active');
            loadSmartMeterData();
        }
    }

    /**
     * Get stored smart meter credentials
     */
    function getSmartMeterCredentials() {
        const stored = localStorage.getItem('smartmeter_config');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
