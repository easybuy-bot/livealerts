<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/helpers.php';
require_once __DIR__ . '/lib/Overlay.php';
require_once __DIR__ . '/lib/YouTube.php';
require_once __DIR__ . '/lib/LivePoller.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');

$token = (string)($_GET['t'] ?? '');
$since = (int)($_GET['since'] ?? 0);

$o = ($token !== '' && preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) ? Overlay::byToken($token) : null;
if (!$o) { http_response_code(403); exit(json_encode(['state' => 'unauthorized'])); }

// Return the SAME authoritative settings shape the OBS page (view.php) uses.
// A freshly-redeemed chat overlay may have NULL settings before its first save;
// fall back to the full schema defaults so the renderer always gets a complete
// tree (an empty {} previously crashed the client on poll). Custom overlays keep
// their own saved settings (their product supplies its own schema).
$savedSettings = json_decode($o['settings'] ?: 'null', true);
$settings = Overlay::isCustom($o)
    ? ($savedSettings ?: new stdClass())
    : ((is_array($savedSettings) && $savedSettings) ? $savedSettings : default_settings());

// A disabled instance stays authorized (its URL is valid) but streams nothing.
if ((int)($o['enabled'] ?? 1) === 0) {
    exit(json_encode(['mode' => (string)$o['source_type'], 'state' => 'disabled', 'reason' => 'overlay_disabled',
                      'settings' => $settings, 'messages' => [], 'cursor' => $since, 'pollMs' => 15000]));
}

$pdo = db();
// Resolve the shared chat source for this overlay's key (create/link if missing).
$sid = (int)($o['source_id'] ?? 0);
if ($sid === 0) {
    $sid = Overlay::ensureSource($pdo, (int)$o['access_key_id']);
    $pdo->prepare('UPDATE overlays SET source_id=? WHERE id=?')->execute([$sid, (int)$o['id']]);
}

/* ---- Demo mode: the browser generates its own sample messages ---- */
if ($o['source_type'] === 'demo') {
    exit(json_encode(['mode' => 'demo', 'settings' => $settings]));
}

/* ---- YouTube live mode (polled once per shared source) ---- */
// Two modes, one shared pipeline (see lib/LivePoller.php):
//   manual  -> a pasted live video id/URL (legacy, unchanged)
//   channel -> a connected channel; the live video + activeLiveChatId are
//              discovered/reconnected automatically, so a vertical + horizontal
//              overlay on the same key still consume ONE polled stream.
$pollMs = 4000;
$state = 'live';
$reason = '';
$now = time();
$apiKey = (string)$o['yt_api_key'];
$ytMode = ((string)($o['yt_mode'] ?? 'manual')) === 'channel' ? 'channel' : 'manual';

if ($apiKey === '') {
    exit(json_encode(['mode' => 'youtube', 'state' => 'offline', 'reason' => 'no_source', 'settings' => $settings, 'messages' => [], 'cursor' => $since, 'pollMs' => 8000]));
}
if ($ytMode === 'manual' && (string)$o['yt_video_id'] === '') {
    exit(json_encode(['mode' => 'youtube', 'state' => 'offline', 'reason' => 'no_source', 'settings' => $settings, 'messages' => [], 'cursor' => $since, 'pollMs' => 8000]));
}
if ($ytMode === 'channel' && (string)($o['yt_channel_id'] ?? '') === '') {
    exit(json_encode(['mode' => 'youtube', 'state' => 'offline', 'reason' => 'no_channel', 'settings' => $settings, 'messages' => [], 'cursor' => $since, 'pollMs' => 12000]));
}

$last = $o['last_poll_at'] ? strtotime($o['last_poll_at']) : 0;
$due = ($now - $last) * 1000 >= 3500;   // throttle YouTube calls per source, regardless of how many overlays poll

if ($due) {
    try {
        $yt = new YouTube($apiKey);
        $res = $ytMode === 'channel'
            ? LivePoller::runChannel($pdo, $yt, $o, $sid)
            : LivePoller::runManual($pdo, $yt, $o, $sid);
        $state = $res['state']; $reason = $res['reason']; $pollMs = $res['pollMs'];
    } catch (Throwable $ex) {
        $code = $ex->getMessage();                 // e.g. "yt:keyInvalid", "yt:quotaExceeded", "yt:forbidden", "network: ..."
        $reason = preg_replace('/^yt:/', '', $code);
        $state = str_contains($code, 'quota') ? 'quota_exceeded' : 'offline';
        $pollMs = 12000;
        $pdo->prepare("UPDATE chat_sources SET last_poll_at=NOW(), last_state=?, last_reason=? WHERE id=?")->execute([$state, $reason, $sid]);
    }
} else {
    // Not our turn to poll; reflect the source's last known health.
    if (!empty($o['last_state'])) { $state = (string)$o['last_state']; $reason = (string)($o['last_reason'] ?? ''); }
}

/* ---- Return buffered messages after the client cursor (shared per source) ---- */
// A fresh client (OBS browser source just (re)loaded) sends since=0. Don't replay
// the entire buffered backlog — start near the tail so only recent + new messages
// stream in. This is what stops an old stream's messages from flooding back after
// a reload or after switching the live-chat link.
if ($since <= 0) {
    $mxSt = $pdo->prepare('SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE source_id=?');
    $mxSt->execute([$sid]);
    $mx = (int)$mxSt->fetchColumn();
    $since = max(0, $mx - 8);   // keep a small context tail
}

$st = $pdo->prepare('SELECT id, payload FROM chat_messages WHERE source_id=? AND id > ? ORDER BY id ASC LIMIT 200');
$st->execute([$sid, $since]);
$rows = $st->fetchAll();
$messages = [];
$cursor = $since;
foreach ($rows as $r) { $messages[] = json_decode($r['payload'], true); $cursor = (int)$r['id']; }

echo json_encode([
    'mode'     => 'youtube',
    'state'    => $state,
    'reason'   => $reason,
    'settings' => $settings,
    'messages' => $messages,
    'cursor'   => $cursor,
    'pollMs'   => $pollMs,
], JSON_UNESCAPED_UNICODE);
