/**
 * Enhanced Smart Meter Integration
 * Use this code to connect to the backend proxy for secure API access
 */

/**
 * Fetch smart meter data through backend proxy (SECURE METHOD)
 */
function fetchSmartMeterViaProxy(credentials) {
    const proxyUrl = 'inc/smartmeter-proxy.php';
    
    // First, login
    fetch(proxyUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            action: 'login',
            username: credentials.username,
            password: atob(credentials.password) // Decode from base64
        })
    })
    .then(response => response.json())
    .then(loginResult => {
        if (loginResult.success) {
            // Now fetch consumption data
            return fetch(proxyUrl + '?action=getConsumption&period=week&meterId=' + (credentials.meterId || ''));
        } else {
            throw new Error(loginResult.error || 'Login failed');
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displaySmartMeterData(data.data);
        } else {
            throw new Error(data.error || 'Failed to fetch consumption data');
        }
    })
    .catch(error => {
        console.error('Smart meter error:', error);
        document.getElementById('smartmeter-value').textContent = 'Fehler';
        document.getElementById('smartmeter-period').textContent = error.message;
    });
}

/**
 * Alternative: Direct API access (requires CORS configuration on Wiener Netze - unlikely to work)
 * This is provided for reference but will likely be blocked by CORS
 */
function fetchSmartMeterDirect(credentials) {
    const loginUrl = 'https://smartmeter-web.wienernetze.at/api/login';
    
    fetch(loginUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username: credentials.username,
            password: atob(credentials.password)
        }),
        credentials: 'include'
    })
    .then(response => response.json())
    .then(loginData => {
        // Fetch consumption data
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        
        const params = new URLSearchParams({
            dateFrom: startDate.toISOString().split('T')[0],
            dateTo: endDate.toISOString().split('T')[0],
            period: 'DAY'
        });
        
        if (credentials.meterId) {
            params.append('zaehlpunkt', credentials.meterId);
        }
        
        return fetch(`https://smartmeter-web.wienernetze.at/api/messdaten?${params}`, {
            credentials: 'include'
        });
    })
    .then(response => response.json())
    .then(data => {
        // Calculate total consumption
        let totalConsumption = 0;
        if (data.messwerte && Array.isArray(data.messwerte)) {
            data.messwerte.forEach(reading => {
                totalConsumption += parseFloat(reading.wert || 0);
            });
        }
        
        displaySmartMeterData({
            weeklyConsumption: totalConsumption.toFixed(2),
            period: 'Diese Woche',
            unit: 'kWh'
        });
    })
    .catch(error => {
        console.error('Smart meter direct access error:', error);
        document.getElementById('smartmeter-value').textContent = 'CORS Fehler';
        document.getElementById('smartmeter-period').textContent = 'Backend Proxy benötigt';
    });
}
