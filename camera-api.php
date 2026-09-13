<?php
declare(strict_types=1);
/**
 * Live Camera Studio — REST API.
 *
 * Auth:   Authorization: Bearer ovhk_xxx      (a studio-scoped api_key)
 * Format: JSON in / JSON out.
 * Routing: ?action=<name> plus HTTP method. Every action declares the scope it
 *          needs; the credential must hold that scope or we return 403. The
 *          studio is derived from the credential itself, so an api_key can only
 *          ever act on its own studio (no cross-tenant access is expressible).
 */
require_once __DIR__ . '/lib/Camera.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function api_out(int $code, array $data): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function api_err(int $code, string $msg, string $type = 'error'): never {
    api_out($code, ['ok' => false, 'error' => $msg, 'type' => $type]);
}

/** Pull the bearer token from the Authorization header (several server quirks). */
function bearer_token(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
        }
    }
    if (preg_match('/Bearer\s+(.+)/i', $h, $m)) return trim($m[1]);
    return '';
}

/** Read a JSON body, falling back to form params. */
function api_input(): array {
    $raw = file_get_contents('php://input') ?: '';
    if ($raw !== '') {
        $j = json_decode($raw, true);
        if (is_array($j)) return $j + $_GET;
    }
    return $_POST + $_GET;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string)($_GET['action'] ?? '');
$in     = api_input();

// ---- Authenticate ----------------------------------------------------------
$token = bearer_token();
if ($token === '') api_err(401, 'Missing Bearer token.', 'auth');
$cred = Camera::authenticateApiKey($token);
if (!$cred) api_err(401, 'Invalid or revoked API key.', 'auth');

$studioId = (int)$cred['studio_id'];
$userId   = (int)$cred['studio_user'];

/** Require a scope or 403. */
$need = function (string $scope) use ($cred) {
    if (!Camera::credHasScope($cred, $scope)) {
        api_err(403, 'This API key is missing the required scope: ' . $scope, 'scope');
    }
};
/** Require a specific HTTP method or 405. */
$only = function (string $m) use ($method) {
    if ($method !== $m) api_err(405, 'Method not allowed. Use ' . $m . '.', 'method');
};

try {
    switch ($action) {

        case '':
        case 'studio':
            $only('GET'); $need('camera:read');
            $s = Camera::find($studioId, $userId);
            if (!$s) api_err(404, 'Studio not found.');
            api_out(200, ['ok'=>true, 'studio'=>[
                'id'=>(int)$s['id'], 'name'=>$s['name'],
                'active_scene_id'=>(int)$s['active_scene_id'],
                'limits'=>[
                    'max_devices'=>(int)$s['max_devices'],
                    'max_scenes'=>(int)$s['max_scenes'],
                    'max_bitrate_kbps'=>(int)$s['max_bitrate_kbps'],
                ],
                'features'=>[
                    'recording'=>(bool)$s['recording_enabled'],
                    'ai_blur'=>(bool)$s['ai_blur_enabled'],
                    'webrtc'=>(bool)$s['webrtc_enabled'],
                ],
            ]]);

        case 'devices':
            $only('GET'); $need('camera:read');
            $devs = array_map(fn($d)=>[
                'id'=>(int)$d['id'],'name'=>$d['name'],'type'=>$d['device_type'],
                'protocol'=>$d['ingest_protocol'],'stream_path'=>$d['stream_path'],
                'status'=>$d['status'],
            ], Camera::devices($studioId, $userId));
            api_out(200, ['ok'=>true, 'devices'=>$devs]);

        case 'device.add':
            $only('POST'); $need('camera:write');
            $name = trim((string)($in['name'] ?? ''));
            if ($name === '') api_err(422, 'name is required.', 'validation');
            $id = Camera::addDevice($studioId, $userId, $name,
                (string)($in['type'] ?? 'rtmp'), $in['model'] ?? null,
                (string)($in['protocol'] ?? 'rtmp'));
            $streamKey = Camera::createDeviceStreamKey($id, $userId);
            // The stream key is returned once here (needed to configure the camera).
            api_out(201, ['ok'=>true, 'device_id'=>$id, 'stream_key'=>$streamKey]);

        case 'scenes':
            $only('GET'); $need('camera:read');
            $scenes = array_map(fn($s)=>[
                'id'=>(int)$s['id'],'name'=>$s['name'],'layout'=>$s['layout'],
                'active'=>false,
            ], Camera::scenes($studioId, $userId));
            $s = Camera::find($studioId, $userId);
            $active = (int)($s['active_scene_id'] ?? 0);
            foreach ($scenes as &$sc) $sc['active'] = ($sc['id'] === $active);
            api_out(200, ['ok'=>true, 'scenes'=>$scenes, 'active_scene_id'=>$active]);

        case 'scene.switch':
            $only('POST'); $need('scene:switch');
            $sceneId = (int)($in['scene_id'] ?? 0);
            if (!Camera::setActiveScene($studioId, $userId, $sceneId))
                api_err(404, 'Scene not found in this studio.');
            api_out(200, ['ok'=>true, 'active_scene_id'=>$sceneId]);

        case 'stream.start':
            $only('POST'); $need('stream:start');
            $deviceId = (int)($in['device_id'] ?? 0);
            $dev = Camera::deviceFind($deviceId, $userId);
            if (!$dev || (int)$dev['studio_id'] !== $studioId)
                api_err(404, 'Device not found in this studio.');
            $sid = Camera::startStream($deviceId, $userId);
            api_out(201, ['ok'=>true, 'stream_id'=>$sid]);

        case 'stream.stop':
            $only('POST'); $need('stream:stop');
            $streamId = (int)($in['stream_id'] ?? 0);
            $stream = Camera::streamFind($streamId, $userId);
            if (!$stream || (int)$stream['studio_id'] !== $studioId)
                api_err(404, 'Stream not found in this studio.');
            Camera::stopStream($streamId, $userId);
            api_out(200, ['ok'=>true]);

        case 'snapshot':
            $only('POST'); $need('snapshot');
            $deviceId = isset($in['device_id']) ? (int)$in['device_id'] : null;
            if ($deviceId) {
                $dev = Camera::deviceFind($deviceId, $userId);
                if (!$dev || (int)$dev['studio_id'] !== $studioId)
                    api_err(404, 'Device not found in this studio.');
            }
            $id = Camera::addSnapshot($studioId, $userId, $deviceId, null, $in['url'] ?? null);
            api_out(201, ['ok'=>true, 'snapshot_id'=>$id]);

        case 'recording.start':
            $only('POST'); $need('recording');
            $deviceId = isset($in['device_id']) ? (int)$in['device_id'] : null;
            $streamId = isset($in['stream_id']) ? (int)$in['stream_id'] : null;
            $id = Camera::startRecording($studioId, $userId, $streamId, $deviceId);
            api_out(201, ['ok'=>true, 'recording_id'=>$id]);

        case 'recording.stop':
            $only('POST'); $need('recording');
            $recId = (int)($in['recording_id'] ?? 0);
            Camera::stopRecording($recId, $userId, [
                'duration_s'=>$in['duration_s'] ?? null,
                'size_bytes'=>$in['size_bytes'] ?? null,
                'url'=>$in['url'] ?? null,
            ]);
            api_out(200, ['ok'=>true]);

        case 'analytics':
            $only('GET'); $need('analytics');
            api_out(200, ['ok'=>true, 'analytics'=>Camera::analyticsSummary($studioId, $userId)]);

        default:
            api_err(404, 'Unknown action: ' . $action, 'route');
    }
} catch (RuntimeException $e) {
    api_err(422, $e->getMessage(), 'validation');
} catch (Throwable $e) {
    api_err(500, 'Internal error.', 'server');
}
