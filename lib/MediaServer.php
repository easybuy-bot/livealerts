<?php
declare(strict_types=1);
require_once __DIR__ . '/../inc/helpers.php';
require_once __DIR__ . '/Camera.php';

/**
 * Thin integration seam between the OverlayHub application and the external
 * media server (MediaMTX / node-media-server) that actually ingests RTMP/SRT
 * and republishes over WebRTC/HLS. See deploy/ for the companion service.
 *
 * The heavy media pipeline lives OUTSIDE PHP. This class only:
 *  - builds the ingest / playback URLs shown to users,
 *  - signs & verifies the webhooks exchanged with the media server,
 *  - authorizes publish attempts against per-device stream keys.
 */
final class MediaServer {

    /** RTMP/SRT ingest URL a camera should publish to (no secret embedded). */
    public static function ingestUrl(array $device): string {
        $base = $device['ingest_protocol'] === 'srt' ? MEDIA_SRT_INGEST : MEDIA_RTMP_INGEST;
        return rtrim($base, '/') . '/' . $device['stream_path'];
    }

    /** WebRTC (WHEP) playback URL for a device stream path. */
    public static function whepUrl(string $streamPath): string {
        return rtrim(MEDIA_WHEP_BASE, '/') . '/' . $streamPath . '/whep';
    }

    /** HLS fallback playback URL. */
    public static function hlsUrl(string $streamPath): string {
        return rtrim(MEDIA_HLS_BASE, '/') . '/' . $streamPath . '/index.m3u8';
    }

    /** HMAC-SHA256 signature over a raw webhook body. */
    public static function sign(string $body): string {
        return hash_hmac('sha256', $body, MEDIA_WEBHOOK_SECRET);
    }

    /** Constant-time verify of an inbound webhook signature. */
    public static function verify(string $body, string $signature): bool {
        if ($signature === '') return false;
        return hash_equals(self::sign($body), $signature);
    }

    /**
     * Authorize a publish attempt (media server on_publish hook).
     * On success, marks the device streaming and opens a stream session.
     * Returns the created stream id, or null when the key is invalid.
     */
    public static function authorizePublish(string $streamPath, string $rawKey, array $meta = []): ?int {
        $dev = Camera::verifyPublish($streamPath, $rawKey);
        if (!$dev) return null;
        $pdo = db();
        $pdo->prepare("UPDATE camera_streams SET status='ended', ended_at=NOW()
                       WHERE device_id=? AND status IN ('starting','live')")->execute([(int)$dev['id']]);
        $ins = $pdo->prepare("INSERT INTO camera_streams
            (studio_id,device_id,user_id,status,media_session,resolution,fps,bitrate_kbps,started_at)
            VALUES (?,?,?, 'live', ?,?,?,?, NOW())");
        $ins->execute([
            (int)$dev['studio_id'], (int)$dev['id'], (int)$dev['user_id'],
            $meta['session'] ?? null, $meta['resolution'] ?? null,
            isset($meta['fps']) ? (int)$meta['fps'] : null,
            isset($meta['bitrate_kbps']) ? (int)$meta['bitrate_kbps'] : null,
        ]);
        $streamId = (int)$pdo->lastInsertId();
        $pdo->prepare("UPDATE camera_devices SET status='streaming', last_seen_at=NOW() WHERE id=?")
            ->execute([(int)$dev['id']]);
        return $streamId;
    }

    /** End the active session for a stream path (on_unpublish hook). */
    public static function endPublish(string $streamPath): bool {
        $pdo = db();
        $st = $pdo->prepare("SELECT * FROM camera_devices WHERE stream_path=? LIMIT 1");
        $st->execute([$streamPath]);
        $dev = $st->fetch();
        if (!$dev) return false;
        $pdo->prepare("UPDATE camera_streams SET status='ended', ended_at=NOW()
                       WHERE device_id=? AND status IN ('starting','live')")->execute([(int)$dev['id']]);
        $pdo->prepare("UPDATE camera_devices SET status='online', last_seen_at=NOW() WHERE id=?")
            ->execute([(int)$dev['id']]);
        return true;
    }

    /** Record a viewer count sample from the media server (analytics). */
    public static function recordViewers(string $streamPath, int $viewers): void {
        $pdo = db();
        $st = $pdo->prepare("SELECT cs.id sid, st.id stid FROM camera_devices d
                             JOIN camera_studios cs ON cs.id=d.studio_id
                             LEFT JOIN camera_streams st ON st.device_id=d.id AND st.status='live'
                             WHERE d.stream_path=? LIMIT 1");
        $st->execute([$streamPath]);
        $row = $st->fetch();
        if (!$row) return;
        Camera::recordMetric((int)$row['sid'], $row['stid'] ? (int)$row['stid'] : null, 'viewers', $viewers);
        if ($row['stid']) {
            $pdo->prepare("UPDATE camera_streams SET viewer_peak=GREATEST(viewer_peak,?) WHERE id=?")
                ->execute([$viewers, (int)$row['stid']]);
        }
    }

    /** Log a webhook event (in or out) for auditing/debugging. */
    public static function logWebhook(?int $studioId, string $direction, string $event, ?string $payload, ?string $status): void {
        try {
            db()->prepare("INSERT INTO camera_webhooks (studio_id,direction,event,payload,status) VALUES (?,?,?,?,?)")
                ->execute([$studioId, $direction, $event, $payload, $status]);
        } catch (Throwable) {}
    }
}
