<?php
declare(strict_types=1);
/*
 |----------------------------------------------------------------------
 | OverlayHub — configuration
 |----------------------------------------------------------------------
 | Edit the values below, then open /install.php once in your browser.
 */

// ---- Database (MySQL / MariaDB) ----
define('DB_HOST', getenv('DB_HOST') ?: '127.0.0.1');
define('DB_NAME', getenv('DB_NAME') ?: 'overlayhub');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');
define('DB_PORT', (int)(getenv('DB_PORT') ?: 3306));

// ---- Site ----
const SITE_NAME = 'OverlayHub';
const SITE_TAGLINE = 'Premium OBS Overlays, Scripts & Stream Tools';
// Leave empty to auto-detect. Example: 'https://yourdomain.com'
const SITE_URL = '';

// ---- Security ----
// Change this to a long random string before going live.
define('APP_SECRET', getenv('APP_SECRET') ?: 'change-this-to-a-long-random-secret-please');

// ---- First admin (created by installer if no admin exists) ----
define('SEED_ADMIN_EMAIL', getenv('SEED_ADMIN_EMAIL') ?: 'admin@overlayhub.local');
define('SEED_ADMIN_PASSWORD', getenv('SEED_ADMIN_PASSWORD') ?: bin2hex(random_bytes(12))); 
const SEED_ADMIN_NAME = 'Administrator';

// ---- Live Camera Studio: media server (companion service) ----
// These point at your MediaMTX / node-media-server deployment (see deploy/).
// RTMP/SRT ingest base the DJI/RTMP camera pushes to (stream key appended):
const MEDIA_RTMP_INGEST = 'rtmp://your-media-server:1935/live';
const MEDIA_SRT_INGEST  = 'srt://your-media-server:8890';
// WHEP (WebRTC) playback base the OBS output / viewer pulls from:
const MEDIA_WHEP_BASE   = 'https://your-media-server:8889';
// HLS fallback base (used when WebRTC is unavailable):
const MEDIA_HLS_BASE    = 'https://your-media-server:8888';
// Shared secret the media server signs its webhooks with (camera-webhook.php):
define('MEDIA_WEBHOOK_SECRET', getenv('MEDIA_WEBHOOK_SECRET') ?: 'change-this-media-webhook-secret');

date_default_timezone_set('UTC');
