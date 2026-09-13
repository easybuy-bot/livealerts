<?php
declare(strict_types=1);
/**
 * Inbound webhook endpoint for the media server (MediaMTX / node-media-server).
 *
 * The media server calls this on stream lifecycle events. Requests are
 * authenticated with an HMAC-SHA256 signature over the raw body using
 * MEDIA_WEBHOOK_SECRET (header: X-OVH-Signature), so only the paired media
 * server can drive stream state.
 *
 * Events:
 *   publish   { path, key, session?, resolution?, fps?, bitrate_kbps? }
 *             -> authorize by per-device stream key; 200 {allow:true} / 403
 *   unpublish { path }                 -> end the session
 *   viewers   { path, viewers }        -> analytics sample
 */
require_once __DIR__ . '/lib/MediaServer.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function wh_out(int $code, array $data): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') wh_out(405, ['ok'=>false,'error'=>'POST only']);

$raw = file_get_contents('php://input') ?: '';
$sig = $_SERVER['HTTP_X_OVH_SIGNATURE'] ?? '';
if (!MediaServer::verify($raw, $sig)) {
    MediaServer::logWebhook(null, 'in', 'rejected', substr($raw, 0, 400), 'bad_signature');
    wh_out(401, ['ok'=>false, 'error'=>'invalid signature']);
}

$body  = json_decode($raw, true) ?: [];
$event = (string)($body['event'] ?? '');
$path  = (string)($body['path'] ?? '');

try {
    switch ($event) {
        case 'publish':
            $streamId = MediaServer::authorizePublish($path, (string)($body['key'] ?? ''), [
                'session'      => $body['session'] ?? null,
                'resolution'   => $body['resolution'] ?? null,
                'fps'          => $body['fps'] ?? null,
                'bitrate_kbps' => $body['bitrate_kbps'] ?? null,
            ]);
            if ($streamId === null) {
                MediaServer::logWebhook(null, 'in', 'publish', $path, 'denied');
                wh_out(403, ['ok'=>false, 'allow'=>false, 'error'=>'invalid stream key']);
            }
            MediaServer::logWebhook(null, 'in', 'publish', $path, 'allowed');
            wh_out(200, ['ok'=>true, 'allow'=>true, 'stream_id'=>$streamId]);

        case 'unpublish':
            MediaServer::endPublish($path);
            MediaServer::logWebhook(null, 'in', 'unpublish', $path, 'ok');
            wh_out(200, ['ok'=>true]);

        case 'viewers':
            MediaServer::recordViewers($path, (int)($body['viewers'] ?? 0));
            wh_out(200, ['ok'=>true]);

        default:
            wh_out(400, ['ok'=>false, 'error'=>'unknown event']);
    }
} catch (Throwable $e) {
    wh_out(500, ['ok'=>false, 'error'=>'server error']);
}
