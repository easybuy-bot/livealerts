<?php
declare(strict_types=1);
/**
 * Public scene-status endpoint for the OBS output + viewer pages.
 *
 * The OBS Browser Source URL (/obs.php?t=TOKEN) NEVER changes. Instead this
 * endpoint is polled every couple of seconds; when the studio's active scene
 * (or its elements) change, the returned `version` hash changes and the page
 * re-composites the scene in place. Reads by obs_token only — no session, no
 * secrets are exposed (device stream paths are public ingest identifiers used
 * for WHEP playback, not credentials).
 */
require_once __DIR__ . '/lib/Camera.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$token = (string)($_GET['t'] ?? '');
$studio = Camera::findByObsToken($token);
if (!$studio) { http_response_code(404); echo json_encode(['ok'=>false,'error'=>'not_found']); exit; }
if ((int)$studio['enabled'] !== 1) { echo json_encode(['ok'=>true,'enabled'=>false]); exit; }

$payload = Camera::obsScenePayload($studio);

// Cheap change token: scene id + a stable hash of the elements/devices state.
$version = substr(hash('sha256', json_encode([
    $payload['scene']['id'] ?? 0,
    $payload['elements'],
    array_map(fn($d)=>[$d['status'],$d['stream_path']], $payload['devices']),
])), 0, 16);

echo json_encode([
    'ok'      => true,
    'enabled' => true,
    'version' => $version,
    'scene'   => $payload['scene'],
    'elements'=> $payload['elements'],
    'devices' => array_values($payload['devices']),
    'whep_base' => MEDIA_WHEP_BASE,
    'hls_base'  => MEDIA_HLS_BASE,
    'webrtc'    => (bool)$studio['webrtc_enabled'],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
