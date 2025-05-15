<?php
header('Content-Type: application/json');
function fetch_url_contents($url) {
    $context = stream_context_create([ 'http' => [ 'timeout' => 5, 'ignore_errors' => true ] ]);
    $data = @file_get_contents($url, false, $context);
    return ($data === false) ? false : $data;
}
$type = isset($_GET['type']) ? $_GET['type'] : '';
if ($type === 'flights') {
    $flights_url = "http://{$_SERVER['SERVER_ADDR']}:8754/flights.json";
    $flights_data = fetch_url_contents($flights_url);
    echo $flights_data ?: json_encode([]);
} else if ($type === 'logs') {
    $logs_url = "http://{$_SERVER['SERVER_ADDR']}:8754/logs.bin";
    $logs_data = fetch_url_contents($logs_url);
    echo json_encode($logs_data ? explode("\n", $logs_data) : []);
} else {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid data type']);
}
?>
