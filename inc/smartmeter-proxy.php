<?php
/**
 * Wien Energie Smart Meter API Proxy
 * This proxy handles authentication and API requests securely on the server side
 * 
 * API Endpoint: https://api.wstw.at/gateway/WN_SMART_METER_API/1.0
 * Documentation: https://api-portal.wienerstadtwerke.at
 * 
 * IMPORTANT: You need an API key from the Wien Energie API Portal
 * Register at: https://api-portal.wienerstadtwerke.at/portal/auth/register
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Restrict this in production!
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Configuration
define('WSTW_API_BASE', 'https://api.wstw.at/gateway/WN_SMART_METER_API/1.0');
define('API_CONSUMPTION_URL', WSTW_API_BASE . '/zaehlpunkte/messwerte');
define('API_LOGIN_URL', 'https://api.wstw.at/gateway/auth/oauth/token'); // OAuth endpoint

// Session configuration
session_start();

/**
 * Main request handler
 */
function handleRequest() {
    $action = $_POST['action'] ?? $_GET['action'] ?? '';
    
    switch ($action) {
        case 'login':
            return handleLogin();
        case 'getConsumption':
            return getConsumption();
        case 'logout':
            return handleLogout();
        default:
            return error('Invalid action');
    }
}

/**
 * Handle login to Wien Energie API
 * This uses API key authentication from the WSTW API Portal
 */
function handleLogin() {
    $apiKey = $_POST['apiKey'] ?? $_POST['password'] ?? '';
    
    if (empty($apiKey)) {
        return error('API Key required. Get one from https://api-portal.wienerstadtwerke.at');
    }
    
    // Store API key in session
    $_SESSION['wstw_api_key'] = $apiKey;
    $_SESSION['wstw_logged_in'] = true;
    
    return success(['message' => 'API Key configured']);
}

/**
 * Get consumption data from Smart Meter API
 */
function getConsumption() {
    $apiKey = $_POST['password'] ?? $_POST['apiKey'] ?? '';
    $meterId = $_POST['meterId'] ?? $_GET['meterId'] ?? '';
    $period = $_POST['period'] ?? $_GET['period'] ?? 'week';
    
    if (empty($apiKey)) {
        return error('API Key required', 401);
    }
    
    if (empty($meterId)) {
        return error('Zählpunktnummer (meterId) is required', 400);
    }
    
    // Calculate date range
    $endDate = new DateTime();
    $startDate = clone $endDate;
    
    switch ($period) {
        case 'day':
            $startDate->modify('-1 day');
            break;
        case 'week':
            $startDate->modify('-7 days');
            break;
        case 'month':
            $startDate->modify('-30 days');
            break;
        case 'year':
            $startDate->modify('-1 year');
            break;
    }
    
    // Build API request
    $ch = curl_init();
    
    $params = [
        'dateFrom' => $startDate->format('Y-m-d'),
        'dateTo' => $endDate->format('Y-m-d'),
        'granularity' => 'DAY'
    ];
    
    // API endpoint with metering point ID
    $url = API_CONSUMPTION_URL . '/' . $meterId . '?' . http_build_query($params);
    
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'X-API-Key: ' . $apiKey  // API key authentication
        ]
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    
    if ($curlError) {
        return error('Connection error: ' . $curlError, 500);
    }
    
    if ($httpCode === 200) {
        $data = json_decode($response, true);
        
        if (json_last_error() !== JSON_ERROR_NONE) {
            return error('Invalid JSON response', 500);
        }
        
        // Calculate total consumption
        $totalConsumption = 0;
        
        // Try different possible response formats
        if (isset($data['values']) && is_array($data['values'])) {
            foreach ($data['values'] as $reading) {
                $totalConsumption += floatval($reading['value'] ?? $reading['wert'] ?? 0);
            }
        } elseif (isset($data['messwerte']) && is_array($data['messwerte'])) {
            foreach ($data['messwerte'] as $reading) {
                $totalConsumption += floatval($reading['wert'] ?? $reading['value'] ?? 0);
            }
        } elseif (isset($data['data']) && is_array($data['data'])) {
            foreach ($data['data'] as $reading) {
                $totalConsumption += floatval($reading['consumption'] ?? $reading['verbrauch'] ?? 0);
            }
        }
        
        return success([
            'weeklyConsumption' => round($totalConsumption, 2),
            'period' => 'Diese Woche',
            'unit' => 'kWh',
            'rawData' => $data
        ]);
    } elseif ($httpCode === 401) {
        return error('Unauthorized: Invalid API Key', 401);
    } elseif ($httpCode === 404) {
        return error('Zählpunkt nicht gefunden', 404);
    } else {
        return error('API error: HTTP ' . $httpCode . ' - ' . substr($response, 0, 200), $httpCode);
    }
}

/**
 * Handle logout
 */
function handleLogout() {
    // Clean up session and cookies
    $cookieFile = sys_get_temp_dir() . '/we_cookies_' . session_id() . '.txt';
    if (file_exists($cookieFile)) {
        unlink($cookieFile);
    }
    
    session_destroy();
    return success(['message' => 'Logged out successfully']);
}

/**
 * Return success response
 */
function success($data) {
    echo json_encode([
        'success' => true,
        'data' => $data
    ]);
    exit();
}

/**
 * Return error response
 */
function error($message, $code = 400) {
    http_response_code($code);
    echo json_encode([
        'success' => false,
        'error' => $message
    ]);
    exit();
}

// Execute request handler
try {
    handleRequest();
} catch (Exception $e) {
    error('Server error: ' . $e->getMessage(), 500);
}
?>
