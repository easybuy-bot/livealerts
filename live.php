<?php
declare(strict_types=1);
/**
 * Public low-latency viewer for a Live Camera Studio (WebRTC/HLS via the same
 * scene compositor as the OBS output). Read-only, by obs_token.
 */
require_once __DIR__ . '/lib/Camera.php';

$token  = (string)($_GET['t'] ?? '');
$studio = Camera::findByObsToken($token);
if (!$studio) { http_response_code(404); header('Content-Type:text/plain'); exit('Stream not found.'); }

$statusUrl = url('camera-status.php?t=' . urlencode($token));
$cssV = @filemtime(__DIR__ . '/assets/camera-obs.css') ?: '1';
$jsV  = @filemtime(__DIR__ . '/assets/camera-obs.js') ?: '1';
?><!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= e($studio['name']) ?> — Live</title>
<link rel="stylesheet" href="<?= e(url('assets/camera-obs.css')) ?>?v=<?= $cssV ?>">
</head>
<body class="cam-viewer">
<div class="cam-viewer-bar">
  <span class="live">LIVE</span>
  <strong><?= e($studio['name']) ?></strong>
</div>
<div id="cam-stage" class="cam-stage"></div>
<script>
window.CAMERA = { statusUrl: <?= json_encode($statusUrl) ?>, interval: 2500 };
</script>
<script src="<?= e(url('assets/camera-obs.js')) ?>?v=<?= $jsV ?>"></script>
</body></html>
