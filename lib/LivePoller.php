<?php
declare(strict_types=1);

require_once __DIR__ . '/YouTube.php';

/**
 * LivePoller — the single server-side engine that keeps a shared chat_source
 * connected to a YouTube live chat. It supports two modes and is the ONE place
 * that talks to the YouTube API for a source, so a key's vertical + horizontal
 * overlays consume one polled stream (no duplicate API traffic).
 *
 *   manual  : the user pastes a live video id/URL (legacy behaviour, unchanged).
 *   channel : the user connects a CHANNEL once; we automatically discover the
 *             current live video + activeLiveChatId, reconnect when the stream
 *             changes, and keep monitoring after a stream ends.
 *
 * All DB writes happen here; each entry point returns
 *   ['state'=>..,'reason'=>..,'pollMs'=>..]  (state = live|offline|...).
 * Real API errors (quota/keyInvalid/network) are thrown so chat.php can surface
 * them; a naturally ended live chat is handled here (not an error).
 */
final class LivePoller
{
    /** Seconds between expensive live-discovery checks while a channel is offline. */
    public const DISCOVERY_INTERVAL = 60;
    /** Reasons that mean "this live chat is simply over" (not a failure). */
    private const ENDED_REASONS = ['liveChatEnded', 'liveChatNotFound', 'liveChatDisabled'];

    /** Lightweight server-side log (reuses audit_logs; never logs the API key). */
    public static function log(string $event, string $detail = ''): void {
        if (function_exists('audit')) { try { audit('yt_' . $event, $detail); } catch (\Throwable) {} }
    }

    /**
     * Verify + connect a channel (used by the dashboard "Connect channel" action
     * and by tests). Resolves the channel via the official API FIRST so we never
     * report success without verification, then stores the persistent channel and
     * clears any previous stream's temporary state. Returns ['id','title','uploads'].
     * Throws (yt:invalidChannel / yt:channelNotFound / ...) on failure.
     */
    public static function connectChannel(PDO $pdo, YouTube $yt, int $sid, ?string $apiKey, string $channelUrl): array
    {
        $ch = $yt->resolveChannel($channelUrl);   // throws on invalid/not-found
        $pdo->prepare(
            "UPDATE chat_sources SET source_type='youtube', yt_mode='channel', yt_api_key=?,
                    yt_channel_url=?, yt_channel_id=?, yt_channel_title=?, yt_uploads_playlist=?,
                    yt_video_id=NULL, live_chat_id=NULL, live_video_title=NULL, next_page_token=NULL,
                    live_status='detecting', last_checked_at=NULL, last_poll_at=NULL,
                    last_message_at=NULL, last_state=NULL, last_reason=NULL
             WHERE id=?"
        )->execute([
            $apiKey, mb_substr($channelUrl, 0, 200), $ch['id'], mb_substr($ch['title'], 0, 200),
            ($ch['uploads'] ?: null), $sid,
        ]);
        $pdo->prepare('DELETE FROM chat_messages WHERE source_id=?')->execute([$sid]);
        self::log('channel_connect', $ch['id'] . ' ' . $ch['title']);
        return $ch;
    }

    /** Human-friendly reason text for API/validation error codes. */
    public static function friendlyError(string $code): string
    {
        $c = preg_replace('/^yt:/', '', $code);
        return match (true) {
            str_contains($c, 'invalidChannel')                     => 'that does not look like a channel URL or @handle.',
            str_contains($c, 'channelNotFound')                    => 'channel not found — check the URL or @handle.',
            str_contains($c, 'quota')                              => 'the API key has hit its daily quota. Try again later.',
            str_contains($c, 'keyInvalid') || str_contains($c, 'badRequest') => 'the API key looks invalid.',
            str_contains($c, 'forbidden') || str_contains($c, 'accessNotConfigured') => 'the API key is not authorised for YouTube Data API v3.',
            str_starts_with($c, 'network')                         => 'could not reach YouTube. Check the connection and try again.',
            default                                                 => $c,
        };
    }

    /* ---------------------------------------------------------------- MANUAL */
    public static function runManual(PDO $pdo, YouTube $yt, array $o, int $sid): array
    {
        $videoId    = (string)($o['yt_video_id'] ?? '');
        $liveChatId = (string)($o['live_chat_id'] ?? '');
        if ($videoId === '') {
            self::mark($pdo, $sid, 'offline', 'no_source', null);
            return ['state' => 'offline', 'reason' => 'no_source', 'pollMs' => 8000];
        }
        if ($liveChatId === '') {
            $liveChatId = (string)($yt->liveChatId($videoId) ?? '');
            if ($liveChatId !== '') {
                $pdo->prepare('UPDATE chat_sources SET live_chat_id=? WHERE id=?')->execute([$liveChatId, $sid]);
            }
        }
        if ($liveChatId === '') {
            self::mark($pdo, $sid, 'offline', 'no_active_chat', 'offline');
            return ['state' => 'offline', 'reason' => 'no_active_chat', 'pollMs' => 10000];
        }
        $r = self::pollChat($pdo, $yt, $sid, $liveChatId, (string)($o['next_page_token'] ?? '') ?: null);
        if ($r['ended']) {
            // Manual mode keeps the video id (the user may restart the same stream)
            // but drops the dead chat id so a resumed stream re-resolves cleanly.
            $pdo->prepare("UPDATE chat_sources SET live_chat_id=NULL, next_page_token=NULL, last_poll_at=NOW(), last_state='offline', last_reason='stream_ended' WHERE id=?")->execute([$sid]);
            self::log('stream_ended', 'manual video ' . $videoId);
            return ['state' => 'offline', 'reason' => 'stream_ended', 'pollMs' => 12000];
        }
        return ['state' => 'live', 'reason' => '', 'pollMs' => $r['pollMs']];
    }

    /* --------------------------------------------------------------- CHANNEL */
    public static function runChannel(PDO $pdo, YouTube $yt, array $o, int $sid): array
    {
        $channelId  = (string)($o['yt_channel_id'] ?? '');
        $uploads    = (string)($o['yt_uploads_playlist'] ?? '');
        $liveChatId = (string)($o['live_chat_id'] ?? '');
        $videoId    = (string)($o['yt_video_id'] ?? '');
        if ($channelId === '') {
            self::mark($pdo, $sid, 'offline', 'no_channel', 'offline');
            return ['state' => 'offline', 'reason' => 'no_channel', 'pollMs' => 15000];
        }

        // (1) No active chat yet -> DISCOVER a live (throttled; this is the only
        //     path that spends discovery quota, and never every few seconds).
        if ($liveChatId === '') {
            $lastCheck = !empty($o['last_checked_at']) ? strtotime((string)$o['last_checked_at']) : 0;
            if ((time() - $lastCheck) < self::DISCOVERY_INTERVAL) {
                // Not time to check again — reflect the last known offline state.
                $pdo->prepare('UPDATE chat_sources SET last_poll_at=NOW() WHERE id=?')->execute([$sid]);
                return ['state' => 'offline', 'reason' => 'no_active_live', 'pollMs' => 15000];
            }
            self::log('discovery', 'channel ' . $channelId);
            $live = $yt->findActiveLiveVideo($channelId, $uploads ?: null);
            if (!$live) {
                $pdo->prepare("UPDATE chat_sources SET live_status='offline', last_checked_at=NOW(), last_poll_at=NOW(), last_state='offline', last_reason='no_active_live' WHERE id=?")->execute([$sid]);
                self::log('discovery_result', 'no active live');
                return ['state' => 'offline', 'reason' => 'no_active_live', 'pollMs' => 20000];
            }
            // Found a live. If it's a NEW video, clear the old stream's buffer/token.
            if ($live['videoId'] !== $videoId) {
                $pdo->prepare('DELETE FROM chat_messages WHERE source_id=?')->execute([$sid]);
                self::log('stream_changed', ($videoId ?: '(none)') . ' -> ' . $live['videoId']);
            }
            $pdo->prepare("UPDATE chat_sources SET yt_video_id=?, live_chat_id=?, live_video_title=?, next_page_token=NULL, live_status='live', last_checked_at=NOW() WHERE id=?")
                ->execute([$live['videoId'], $live['liveChatId'], mb_substr($live['title'], 0, 300), $sid]);
            // keep legacy per-overlay column loosely in sync for old readers
            $pdo->prepare('UPDATE overlays SET yt_video_id=? WHERE source_id=?')->execute([$live['videoId'], $sid]);
            self::log('chat_resolved', 'video ' . $live['videoId']);
            $liveChatId = $live['liveChatId'];
            $videoId    = $live['videoId'];
        }

        // (2) We have an active live chat -> poll it (cheap, reuses the buffer).
        $r = self::pollChat($pdo, $yt, $sid, $liveChatId, (string)($o['next_page_token'] ?? '') ?: null);
        if ($r['ended']) {
            // Stream ended: drop the temporary live info but KEEP the channel and
            // resume monitoring. The user never has to reconnect.
            $pdo->prepare("UPDATE chat_sources SET yt_video_id=NULL, live_chat_id=NULL, live_video_title=NULL, next_page_token=NULL, live_status='ended', last_checked_at=NOW(), last_poll_at=NOW(), last_state='offline', last_reason='stream_ended' WHERE id=?")->execute([$sid]);
            $pdo->prepare('UPDATE overlays SET yt_video_id=NULL WHERE source_id=?')->execute([$sid]);
            self::log('stream_ended', 'channel ' . $channelId . ' video ' . $videoId);
            return ['state' => 'offline', 'reason' => 'stream_ended', 'pollMs' => 15000];
        }
        $pdo->prepare("UPDATE chat_sources SET live_status='live' WHERE id=?")->execute([$sid]);
        return ['state' => 'live', 'reason' => '', 'pollMs' => $r['pollMs']];
    }

    /* ------------------------------------------------------- shared plumbing */

    /**
     * Poll an already-known live chat: fetch, dedup-insert, advance the page
     * token, trim the buffer. Returns ['ended'=>bool,'pollMs'=>int].
     * A naturally ended chat is reported (ended=true); other API errors throw.
     */
    public static function pollChat(PDO $pdo, YouTube $yt, int $sid, string $liveChatId, ?string $nextToken): array
    {
        try {
            [$msgs, $next, $ms] = $yt->messages($liveChatId, $nextToken);
        } catch (\RuntimeException $e) {
            $reason = preg_replace('/^yt:/', '', $e->getMessage());
            if (in_array($reason, self::ENDED_REASONS, true)) {
                return ['ended' => true, 'pollMs' => 12000];
            }
            throw $e; // quota / keyInvalid / network — real errors bubble up
        }
        $pollMs = max(3000, (int)$ms);
        if ($msgs) self::ingest($pdo, $sid, $msgs);
        $pdo->prepare("UPDATE chat_sources SET next_page_token=?, last_poll_at=NOW(), last_state='live', last_reason='' WHERE id=?")
            ->execute([$next, $sid]);
        self::trim($pdo, $sid);
        return ['ended' => false, 'pollMs' => $pollMs];
    }

    /** Dedup-insert messages by provider id so repeats never pile up. Returns #added. */
    public static function ingest(PDO $pdo, int $sid, array $msgs): int
    {
        $existing = [];
        $ex = $pdo->prepare('SELECT payload FROM chat_messages WHERE source_id=? ORDER BY id DESC LIMIT 300');
        $ex->execute([$sid]);
        foreach ($ex->fetchAll() as $r) {
            $d = json_decode($r['payload'], true);
            if (isset($d['id']) && $d['id'] !== null) $existing[(string)$d['id']] = true;
        }
        $ins = $pdo->prepare('INSERT INTO chat_messages (overlay_id, source_id, payload) VALUES (NULL,?,?)');
        $added = 0;
        foreach ($msgs as $m) {
            $mid = isset($m['id']) && $m['id'] !== null ? (string)$m['id'] : '';
            if ($mid !== '' && isset($existing[$mid])) continue;
            $ins->execute([$sid, json_encode($m, JSON_UNESCAPED_UNICODE)]);
            if ($mid !== '') $existing[$mid] = true;
            $added++;
        }
        if ($added) $pdo->prepare('UPDATE chat_sources SET last_message_at=NOW() WHERE id=?')->execute([$sid]);
        return $added;
    }

    /** Keep the shared buffer small (per source). CAST avoids BIGINT UNSIGNED underflow when few rows exist. */
    public static function trim(PDO $pdo, int $sid): void
    {
        $pdo->prepare('DELETE FROM chat_messages WHERE source_id=? AND id <= (SELECT mx FROM (SELECT GREATEST(CAST(MAX(id) AS SIGNED)-300,0) AS mx FROM chat_messages WHERE source_id=?) t)')
            ->execute([$sid, $sid]);
    }

    private static function mark(PDO $pdo, int $sid, string $state, string $reason, ?string $liveStatus): void
    {
        if ($liveStatus !== null) {
            $pdo->prepare('UPDATE chat_sources SET last_poll_at=NOW(), last_state=?, last_reason=?, live_status=? WHERE id=?')
                ->execute([$state, $reason, $liveStatus, $sid]);
        } else {
            $pdo->prepare('UPDATE chat_sources SET last_poll_at=NOW(), last_state=?, last_reason=? WHERE id=?')
                ->execute([$state, $reason, $sid]);
        }
    }
}
