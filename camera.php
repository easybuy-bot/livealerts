<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/layout.php';
require_once __DIR__ . '/lib/Camera.php';

$u = require_login();
$uid = (int)$u['id'];

$studioId = (int)($_GET['id'] ?? 0);
$studio = $studioId ? Camera::find($studioId, $uid) : null;
if (!$studio) { http_response_code(404); page_head('Studio'); echo '<div class="panel"><h2>Studio not found</h2><p class="sub">This camera studio does not exist or is not on your account.</p><a class="btn" href="'.e(url('dashboard.php')).'">← Back to dashboard</a></div>'; page_foot(); exit; }

$err = null;
$reveal = $_SESSION['cam_reveal'] ?? null; unset($_SESSION['cam_reveal']);

/**
 * Build the exact publish values a camera/encoder needs.
 * $rawKey null -> use a placeholder (persistent help where the secret is hidden).
 * Returns: server (OBS "Server"), streamkey (OBS "Stream Key"), full (single-field
 * URL for apps like DJI Mimo that take one RTMP field).
 */
function cam_pub(array $dev, ?string $rawKey = null): array {
    $key  = $rawKey ?? '<YOUR-STREAM-KEY>';
    $path = $dev['stream_path'];
    if (($dev['ingest_protocol'] ?? 'rtmp') === 'srt') {
        $server   = MEDIA_SRT_INGEST;
        $streamid = 'publish:' . $path . '?key=' . $key;
        return ['proto'=>'srt', 'server'=>$server, 'streamkey'=>$streamid,
                'full'=>$server . '?streamid=' . $streamid];
    }
    $server = MEDIA_RTMP_INGEST;                 // rtmp://host:1935/live
    return ['proto'=>'rtmp', 'server'=>$server,
            'streamkey'=>$path . '?key=' . $key, // OBS "Stream Key" field
            'full'=>$server . '/' . $path . '?key=' . $key]; // DJI Mimo single field
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = (string)($_POST['action'] ?? '');
    try {
        switch ($action) {
            case 'rename':
                $name = trim((string)($_POST['name'] ?? ''));
                if ($name !== '') {
                    db()->prepare('UPDATE camera_studios SET name=? WHERE id=? AND user_id=?')
                        ->execute([$name, $studioId, $uid]);
                    audit('camera_rename', $name);
                }
                flash('Studio renamed.');
                break;
            case 'device_add':
                $newDev = Camera::addDevice($studioId, $uid, trim((string)($_POST['name'] ?? 'Camera')),
                    (string)($_POST['device_type'] ?? 'rtmp'), $_POST['model'] ?? null,
                    (string)($_POST['ingest_protocol'] ?? 'rtmp'));
                $rawKey = Camera::createDeviceStreamKey($newDev, $uid);
                $_SESSION['cam_reveal'] = ['kind'=>'Camera stream key','raw'=>$rawKey,
                    'pub'=>cam_pub(Camera::deviceFind($newDev, $uid), $rawKey)];
                flash('Camera added — copy its stream key now, it is shown once.'); break;
            case 'streamkey_regen':
                $rawKey = Camera::createDeviceStreamKey((int)$_POST['device_id'], $uid);
                $_SESSION['cam_reveal'] = ['kind'=>'Camera stream key','raw'=>$rawKey,
                    'pub'=>cam_pub(Camera::deviceFind((int)$_POST['device_id'], $uid), $rawKey)];
                flash('New stream key generated — copy it now, it is shown once.'); break;
            case 'device_delete':
                Camera::deleteDevice((int)$_POST['device_id'], $uid);
                flash('Camera removed.'); break;
            case 'scene_add':
                Camera::addScene($studioId, $uid, trim((string)($_POST['name'] ?? 'Scene')),
                    (string)($_POST['layout'] ?? 'single'));
                flash('Scene added.'); break;
            case 'scene_switch':
                if (Camera::setActiveScene($studioId, $uid, (int)$_POST['scene_id'])) flash('Scene switched live.');
                else $err = 'Scene not found.';
                break;
            case 'scene_delete':
                Camera::deleteScene((int)$_POST['scene_id'], $uid); flash('Scene deleted.'); break;
            case 'element_add':
                Camera::addElement((int)$_POST['scene_id'], $uid, [
                    'element_type' => (string)($_POST['element_type'] ?? 'camera'),
                    'device_id'    => ($_POST['device_id'] ?? '') !== '' ? (int)$_POST['device_id'] : null,
                    'label'        => $_POST['label'] ?? null,
                    'x'=>$_POST['x']??0,'y'=>$_POST['y']??0,'w'=>$_POST['w']??100,'h'=>$_POST['h']??100,
                    'props'        => ['text'=>$_POST['text'] ?? '', 'url'=>$_POST['url'] ?? ''],
                ]);
                flash('Element added to scene.'); break;
            case 'element_delete':
                Camera::deleteElement((int)$_POST['element_id'], $uid); flash('Element removed.'); break;
            case 'cred_generate':
                $scopes = array_keys($_POST['scopes'] ?? []);
                $r = Camera::createCredential(db(), $studioId, $uid, 'api_key',
                    trim((string)($_POST['label'] ?? 'API key')), $scopes);
                $_SESSION['cam_reveal'] = ['kind'=>'API key','raw'=>$r['raw']];
                audit('camera_apikey', 'studio ' . $studioId);
                flash('API key created — copy it now, it is shown once.'); break;
            case 'cred_revoke':
                Camera::revokeCredential((int)$_POST['cred_id'], $studioId, $uid);
                flash('Credential revoked.'); break;
            case 'zone_add':
                Camera::addPrivacyZone((int)$_POST['device_id'], $uid, [
                    'name'=>$_POST['name']??'Zone','shape'=>$_POST['shape']??'rect',
                    'x'=>$_POST['x']??0,'y'=>$_POST['y']??0,'w'=>$_POST['w']??20,'h'=>$_POST['h']??20,
                    'blur_strength'=>$_POST['blur_strength']??20,
                ]);
                flash('Privacy zone added.'); break;
            case 'zone_delete':
                Camera::deletePrivacyZone((int)$_POST['zone_id'], $uid); flash('Privacy zone removed.'); break;
            case 'proc_update':
                Camera::updateProcessingProfile((int)$_POST['profile_id'], $uid, [
                    'resolution'=>$_POST['resolution']??'1920x1080','fps'=>(int)($_POST['fps']??30),
                    'bitrate_kbps'=>(int)($_POST['bitrate_kbps']??4500),'codec'=>$_POST['codec']??'h264',
                    'face_blur_enabled'=>isset($_POST['face_blur_enabled'])?1:0,
                    'face_blur_strength'=>(int)($_POST['face_blur_strength']??25),
                    'denoise'=>isset($_POST['denoise'])?1:0,
                ]);
                flash('Processing profile saved.'); break;
            case 'audio_update':
                Camera::updateAudioProfile((int)$_POST['profile_id'], $uid, [
                    'gain_db'=>(float)($_POST['gain_db']??0),
                    'noise_suppression'=>isset($_POST['noise_suppression'])?1:0,
                    'echo_cancel'=>isset($_POST['echo_cancel'])?1:0,
                    'muted'=>isset($_POST['muted'])?1:0,
                ]);
                flash('Audio profile saved.'); break;
            case 'snapshot':
                Camera::addSnapshot($studioId, $uid, ($_POST['device_id']??'')!==''?(int)$_POST['device_id']:null, null);
                flash('Snapshot captured.'); break;
        }
        if (!$err) redirect('camera.php?id=' . $studioId . (isset($_POST['scene_focus'])?'&scene='.(int)$_POST['scene_focus']:''));
    } catch (Throwable $ex) { $err = $ex->getMessage(); }
}

// Reload after any mutation.
$studio   = Camera::find($studioId, $uid);
$devices  = Camera::devices($studioId, $uid);
$scenes   = Camera::scenes($studioId, $uid);
$apiKeys  = Camera::credentials($studioId, $uid, 'api_key');
$streamKeys = Camera::credentials($studioId, $uid, 'stream_key');
$procs    = Camera::processingProfiles($studioId, $uid);
$auds     = Camera::audioProfiles($studioId, $uid);
$recs     = Camera::recordings($studioId, $uid, 10);
$snaps    = Camera::snapshots($studioId, $uid, 10);
$summary  = Camera::analyticsSummary($studioId, $uid);
$activeScene = (int)($studio['active_scene_id'] ?? 0);

$focusSceneId = (int)($_GET['scene'] ?? 0);
$focusScene = $focusSceneId ? Camera::sceneFind($focusSceneId, $uid) : null;
$focusElements = ($focusScene && (int)$focusScene['studio_id']===$studioId) ? Camera::elements($focusSceneId, $uid) : [];

$devById = [];
foreach ($devices as $d) $devById[(int)$d['id']] = $d;

$obsUrl  = url('obs.php?t=' . $studio['obs_token']);
$liveUrl = url('live.php?t=' . $studio['obs_token']);

$cssV = @filemtime(__DIR__ . '/assets/camera.css') ?: '1';
page_head('Camera Studio');
?>
<link rel="stylesheet" href="<?= e(url('assets/camera.css')) ?>?v=<?= $cssV ?>">

<div class="sec-h">
  <div><h2>🎥 <?= e($studio['name']) ?></h2>
    <p>Live Camera Studio · key <span class="mono"><?= e($studio['key_code']) ?></span></p></div>
  <div><a class="btn btn-ghost" href="<?= e(url('dashboard.php')) ?>">← Dashboard</a></div>
</div>

<?php if ($err): ?><div class="err"><?= e($err) ?></div><?php endif; ?>
<?php if ($reveal): ?>
  <div class="note reveal"><b><?= e($reveal['kind']) ?> (copy now, shown once):</b>
    <div class="mono reveal-val"><?= e($reveal['raw']) ?></div>
    <?php if (!empty($reveal['pub'])): $pb = $reveal['pub']; ?>
      <div class="pub-block">
        <div class="pub-row"><span>OBS — Server</span><input readonly value="<?= e($pb['server']) ?>" onclick="this.select()"></div>
        <div class="pub-row"><span>OBS — Stream Key</span><input readonly value="<?= e($pb['streamkey']) ?>" onclick="this.select()"></div>
        <div class="pub-row"><span>DJI Mimo / single-field URL</span><input readonly value="<?= e($pb['full']) ?>" onclick="this.select()"></div>
        <p class="sub" style="margin:8px 0 0">DJI Mimo → Live Streaming → <b>RTMP</b> → poora upar wala URL paste karo. OBS → Settings → Stream → Custom → Server + Stream Key alag-alag.</p>
      </div>
    <?php endif; ?>
  </div>
<?php endif; ?>

<!-- Overview -->
<div class="panel">
  <h2>OBS output</h2>
  <p class="sub">Add this as a <b>Browser Source</b> in OBS. The URL never changes — switch scenes live from below.</p>
  <div class="cam-url"><input readonly value="<?= e($obsUrl) ?>" onclick="this.select()"><a class="btn" href="<?= e($obsUrl) ?>" target="_blank">Open</a></div>
  <p class="sub" style="margin-top:12px">Public viewer link:</p>
  <div class="cam-url"><input readonly value="<?= e($liveUrl) ?>" onclick="this.select()"><a class="btn" href="<?= e($liveUrl) ?>" target="_blank">Open</a></div>
  <div class="cam-stats">
    <div><span><?= (int)$summary['devices'] ?></span>Cameras</div>
    <div><span><?= count($scenes) ?></span>Scenes</div>
    <div><span><?= (int)$summary['streams'] ?></span>Stream sessions</div>
    <div><span><?= (int)$summary['recordings'] ?></span>Recordings</div>
  </div>
  <form method="post" class="row" style="margin-top:14px;align-items:flex-end">
    <?= csrf_field() ?><input type="hidden" name="action" value="rename">
    <div class="field" style="flex:2;margin:0"><label>Studio name</label>
      <input name="name" value="<?= e($studio['name']) ?>"></div>
    <div><button class="btn">Save</button></div>
  </form>
</div>

<!-- Cameras -->
<div class="panel">
  <h2>Cameras <span class="pill"><?= count($devices) ?>/<?= (int)$studio['max_devices'] ?></span></h2>
  <p class="sub">Point your DJI / RTMP / SRT camera at the ingest URL below using its stream key.</p>
  <details class="yt-help" style="margin-bottom:14px">
    <summary>📷 How to connect a camera (OBS &amp; DJI Mimo)</summary>
    <div class="yt-steps">
      <p><b>Server (same for every camera):</b> <span class="mono"><?= e(MEDIA_RTMP_INGEST) ?></span></p>
      <p><b>Stream key format:</b> <span class="mono">&lt;stream-path&gt;?key=&lt;stream-key&gt;</span> —
         each camera's <i>stream-path</i> is shown in the table below (e.g. <span class="mono">cam_ab12…</span>);
         click <b>Stream key</b> on that camera to reveal its one-time secret.</p>
      <p><b>DJI Mimo:</b> Live Streaming → <b>RTMP</b> (Custom) → paste the single full URL:
         <span class="mono"><?= e(MEDIA_RTMP_INGEST) ?>/&lt;stream-path&gt;?key=&lt;stream-key&gt;</span> → Start Live.</p>
      <p><b>OBS Studio:</b> Settings → Stream → Service <b>Custom…</b> → <b>Server</b> = the value above,
         <b>Stream Key</b> = <span class="mono">&lt;stream-path&gt;?key=&lt;stream-key&gt;</span>.</p>
      <p><b>SRT:</b> use <span class="mono"><?= e(MEDIA_SRT_INGEST) ?>?streamid=publish:&lt;stream-path&gt;?key=&lt;stream-key&gt;</span>.</p>
      <p class="mut">Adding a camera (or clicking <b>Stream key</b>) shows the exact ready-to-paste values, filled in for you — copy them right away, the secret is shown once.</p>
    </div>
  </details>
  <?php if (!$devices): ?><div class="note">No cameras yet. Add one below.</div><?php else: ?>
  <div class="table-wrap"><table>
    <thead><tr><th>Camera</th><th>Type</th><th>Ingest</th><th>Status</th><th></th></tr></thead>
    <tbody>
    <?php foreach ($devices as $d):
      $ingest = ($d['ingest_protocol']==='srt'? MEDIA_SRT_INGEST : MEDIA_RTMP_INGEST) . '/' . $d['stream_path']; ?>
      <tr>
        <td><strong><?= e($d['name']) ?></strong><?php if($d['model']):?><br><span class="sub"><?= e($d['model']) ?></span><?php endif;?></td>
        <td><span class="tag"><?= e($d['device_type']) ?></span></td>
        <td class="mono" style="font-size:12px"><?= e($ingest) ?></td>
        <td><span class="badge <?= $d['status']==='streaming'?'active':($d['status']==='error'?'expired':'') ?>"><?= e(ucfirst($d['status'])) ?></span></td>
        <td>
          <a class="btn btn-sm" href="<?= e(url('camera.php?id='.$studioId.'&device='.$d['id'])) ?>">Privacy</a>
          <form method="post" style="display:inline">
            <?= csrf_field() ?><input type="hidden" name="action" value="streamkey_regen">
            <input type="hidden" name="device_id" value="<?= (int)$d['id'] ?>">
            <button class="btn btn-sm">Stream key</button></form>
          <form method="post" style="display:inline" onsubmit="return confirm('Remove this camera?')">
            <?= csrf_field() ?><input type="hidden" name="action" value="device_delete">
            <input type="hidden" name="device_id" value="<?= (int)$d['id'] ?>">
            <button class="btn btn-sm btn-danger">Delete</button></form>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody></table></div>
  <?php endif; ?>
  <form method="post" class="row" style="margin-top:12px;align-items:flex-end;flex-wrap:wrap">
    <?= csrf_field() ?><input type="hidden" name="action" value="device_add">
    <div class="field" style="margin:0"><label>Name</label><input name="name" placeholder="DJI Osmo" required></div>
    <div class="field" style="margin:0"><label>Type</label>
      <select name="device_type"><option value="dji">DJI</option><option value="rtmp">RTMP</option><option value="srt">SRT</option><option value="webrtc">WebRTC</option><option value="other">Other</option></select></div>
    <div class="field" style="margin:0"><label>Protocol</label>
      <select name="ingest_protocol"><option value="rtmp">RTMP</option><option value="srt">SRT</option><option value="whip">WHIP</option></select></div>
    <div><button class="btn btn-primary">Add camera</button></div>
  </form>
</div>

<!-- Scenes -->
<div class="panel">
  <h2>Scenes <span class="pill"><?= count($scenes) ?>/<?= (int)$studio['max_scenes'] ?></span></h2>
  <p class="sub">Click <b>Go live</b> to switch what OBS shows — no need to touch OBS.</p>
  <div class="scene-grid">
    <?php foreach ($scenes as $sc): $isActive = (int)$sc['id']===$activeScene; ?>
      <div class="scene-card <?= $isActive?'active':'' ?>">
        <div class="scene-top"><strong><?= e($sc['name']) ?></strong>
          <span class="tag"><?= e($sc['layout']) ?></span></div>
        <?php if ($isActive): ?><div class="scene-live">● LIVE</div><?php endif; ?>
        <div class="scene-actions">
          <?php if (!$isActive): ?>
          <form method="post"><?= csrf_field() ?><input type="hidden" name="action" value="scene_switch">
            <input type="hidden" name="scene_id" value="<?= (int)$sc['id'] ?>">
            <button class="btn btn-sm btn-primary">Go live</button></form>
          <?php endif; ?>
          <a class="btn btn-sm" href="<?= e(url('camera.php?id='.$studioId.'&scene='.$sc['id'])) ?>">Edit</a>
          <form method="post" onsubmit="return confirm('Delete scene?')"><?= csrf_field() ?>
            <input type="hidden" name="action" value="scene_delete"><input type="hidden" name="scene_id" value="<?= (int)$sc['id'] ?>">
            <button class="btn btn-sm btn-danger">✕</button></form>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
  <form method="post" class="row" style="margin-top:12px;align-items:flex-end">
    <?= csrf_field() ?><input type="hidden" name="action" value="scene_add">
    <div class="field" style="margin:0"><label>New scene name</label><input name="name" placeholder="Interview" required></div>
    <div class="field" style="margin:0"><label>Layout</label>
      <select name="layout"><option value="single">Single</option><option value="pip">Picture-in-picture</option><option value="side">Side by side</option><option value="grid">Grid</option></select></div>
    <div><button class="btn btn-primary">Add scene</button></div>
  </form>
</div>

<?php if ($focusScene && (int)$focusScene['studio_id']===$studioId): ?>
<!-- Scene element editor -->
<div class="panel">
  <h2>Edit scene: <?= e($focusScene['name']) ?></h2>
  <p class="sub">Elements are layered by z-index. Camera elements without explicit size use the scene layout slots.</p>
  <?php if (!$focusElements): ?><div class="note">No elements yet.</div><?php else: ?>
  <div class="table-wrap"><table>
    <thead><tr><th>Type</th><th>Camera</th><th>Box (x,y,w,h)</th><th>z</th><th></th></tr></thead><tbody>
    <?php foreach ($focusElements as $el): ?>
      <tr><td><span class="tag"><?= e($el['element_type']) ?></span></td>
        <td><?= $el['device_id']? e($devById[(int)$el['device_id']]['name'] ?? ('#'.$el['device_id'])):'—' ?></td>
        <td class="mono" style="font-size:12px"><?= e($el['x'].','.$el['y'].','.$el['w'].','.$el['h']) ?></td>
        <td><?= (int)$el['z_index'] ?></td>
        <td><form method="post" style="display:inline"><?= csrf_field() ?>
          <input type="hidden" name="action" value="element_delete"><input type="hidden" name="element_id" value="<?= (int)$el['id'] ?>">
          <input type="hidden" name="scene_focus" value="<?= (int)$focusScene['id'] ?>">
          <button class="btn btn-sm btn-danger">Remove</button></form></td></tr>
    <?php endforeach; ?>
    </tbody></table></div>
  <?php endif; ?>
  <form method="post" class="row" style="margin-top:12px;align-items:flex-end;flex-wrap:wrap">
    <?= csrf_field() ?><input type="hidden" name="action" value="element_add">
    <input type="hidden" name="scene_id" value="<?= (int)$focusScene['id'] ?>">
    <input type="hidden" name="scene_focus" value="<?= (int)$focusScene['id'] ?>">
    <div class="field" style="margin:0"><label>Type</label>
      <select name="element_type"><option value="camera">Camera</option><option value="text">Text</option><option value="image">Image</option><option value="overlay">Overlay iframe</option></select></div>
    <div class="field" style="margin:0"><label>Camera</label>
      <select name="device_id"><option value="">—</option><?php foreach($devices as $d):?><option value="<?= (int)$d['id']?>"><?= e($d['name'])?></option><?php endforeach;?></select></div>
    <div class="field" style="margin:0;max-width:130px"><label>Text / URL</label><input name="text" placeholder="optional"></div>
    <div class="field" style="margin:0;max-width:70px"><label>x</label><input name="x" value="0"></div>
    <div class="field" style="margin:0;max-width:70px"><label>y</label><input name="y" value="0"></div>
    <div class="field" style="margin:0;max-width:70px"><label>w</label><input name="w" value="100"></div>
    <div class="field" style="margin:0;max-width:70px"><label>h</label><input name="h" value="100"></div>
    <div><button class="btn btn-primary">Add element</button></div>
  </form>
</div>
<?php endif; ?>

<?php
$focusDeviceId = (int)($_GET['device'] ?? 0);
$focusDevice = $focusDeviceId ? Camera::deviceFind($focusDeviceId, $uid) : null;
if ($focusDevice && (int)$focusDevice['studio_id']===$studioId):
  $zones = Camera::privacyZones($focusDeviceId, $uid); ?>
<!-- Privacy zones -->
<div class="panel">
  <h2>Privacy zones: <?= e($focusDevice['name']) ?></h2>
  <p class="sub">Fixed regions the AI worker blurs on this camera (percentages of the frame).</p>
  <?php if (!$zones): ?><div class="note">No privacy zones.</div><?php else: ?>
  <div class="table-wrap"><table><thead><tr><th>Name</th><th>Shape</th><th>Box</th><th>Blur</th><th></th></tr></thead><tbody>
    <?php foreach($zones as $z):?><tr><td><?= e($z['name'])?></td><td><?= e($z['shape'])?></td>
      <td class="mono" style="font-size:12px"><?= e($z['x'].','.$z['y'].','.$z['w'].','.$z['h'])?></td>
      <td><?= (int)$z['blur_strength']?></td>
      <td><form method="post" style="display:inline"><?= csrf_field()?><input type="hidden" name="action" value="zone_delete">
        <input type="hidden" name="zone_id" value="<?= (int)$z['id']?>"><button class="btn btn-sm btn-danger">Remove</button></form></td></tr>
    <?php endforeach;?></tbody></table></div>
  <?php endif; ?>
  <form method="post" class="row" style="margin-top:12px;align-items:flex-end;flex-wrap:wrap">
    <?= csrf_field()?><input type="hidden" name="action" value="zone_add"><input type="hidden" name="device_id" value="<?= (int)$focusDevice['id']?>">
    <div class="field" style="margin:0"><label>Name</label><input name="name" placeholder="Face" required></div>
    <div class="field" style="margin:0"><label>Shape</label><select name="shape"><option value="rect">Rect</option><option value="ellipse">Ellipse</option></select></div>
    <div class="field" style="margin:0;max-width:70px"><label>x</label><input name="x" value="10"></div>
    <div class="field" style="margin:0;max-width:70px"><label>y</label><input name="y" value="10"></div>
    <div class="field" style="margin:0;max-width:70px"><label>w</label><input name="w" value="20"></div>
    <div class="field" style="margin:0;max-width:70px"><label>h</label><input name="h" value="20"></div>
    <div class="field" style="margin:0;max-width:90px"><label>Blur</label><input name="blur_strength" value="20"></div>
    <div><button class="btn btn-primary">Add zone</button></div>
  </form>
</div>
<?php endif; ?>

<!-- Processing + Audio -->
<div class="panel cols2">
  <div>
    <h2>Video processing</h2>
    <?php $pp = $procs[0] ?? null; if ($pp): ?>
    <form method="post"><?= csrf_field() ?><input type="hidden" name="action" value="proc_update">
      <input type="hidden" name="profile_id" value="<?= (int)$pp['id'] ?>">
      <div class="field"><label>Resolution</label>
        <select name="resolution"><?php foreach(['3840x2160','2560x1440','1920x1080','1280x720','854x480'] as $r):?>
          <option <?= $pp['resolution']===$r?'selected':''?>><?= $r?></option><?php endforeach;?></select></div>
      <div class="row"><div class="field"><label>FPS</label><input name="fps" value="<?= (int)$pp['fps']?>"></div>
        <div class="field"><label>Bitrate (kbps)</label><input name="bitrate_kbps" value="<?= (int)$pp['bitrate_kbps']?>"></div>
        <div class="field"><label>Codec</label><select name="codec"><?php foreach(['h264','h265','av1'] as $c):?><option <?= $pp['codec']===$c?'selected':''?>><?= $c?></option><?php endforeach;?></select></div></div>
      <label class="chk"><input type="checkbox" name="face_blur_enabled" <?= $pp['face_blur_enabled']?'checked':''?>> AI face blur</label>
      <div class="field"><label>Face blur strength</label><input name="face_blur_strength" value="<?= (int)$pp['face_blur_strength']?>"></div>
      <label class="chk"><input type="checkbox" name="denoise" <?= $pp['denoise']?'checked':''?>> Denoise</label>
      <div style="margin-top:10px"><button class="btn btn-primary">Save video</button></div>
    </form>
    <?php endif; ?>
  </div>
  <div>
    <h2>Audio</h2>
    <?php $ap = $auds[0] ?? null; if ($ap): ?>
    <form method="post"><?= csrf_field() ?><input type="hidden" name="action" value="audio_update">
      <input type="hidden" name="profile_id" value="<?= (int)$ap['id'] ?>">
      <div class="field"><label>Gain (dB)</label><input name="gain_db" value="<?= e($ap['gain_db'])?>"></div>
      <label class="chk"><input type="checkbox" name="noise_suppression" <?= $ap['noise_suppression']?'checked':''?>> Noise suppression</label>
      <label class="chk"><input type="checkbox" name="echo_cancel" <?= $ap['echo_cancel']?'checked':''?>> Echo cancellation</label>
      <label class="chk"><input type="checkbox" name="muted" <?= $ap['muted']?'checked':''?>> Muted</label>
      <div style="margin-top:10px"><button class="btn btn-primary">Save audio</button></div>
    </form>
    <?php endif; ?>
  </div>
</div>

<!-- API credentials -->
<div class="panel">
  <h2>API keys</h2>
  <p class="sub">Scoped keys for the REST API (<span class="mono">camera-api.php</span>). Secrets are shown once.</p>
  <?php if ($apiKeys): ?>
  <div class="table-wrap"><table><thead><tr><th>Label</th><th>Prefix</th><th>Scopes</th><th>Status</th><th>Last used</th><th></th></tr></thead><tbody>
    <?php foreach($apiKeys as $c):?><tr>
      <td><?= e($c['label'])?></td><td class="mono"><?= e($c['secret_prefix'])?>…</td>
      <td class="sub" style="font-size:12px"><?= e($c['scopes'] ?: '—')?></td>
      <td><span class="badge <?= $c['status']==='active'?'active':'expired'?>"><?= e($c['status'])?></span></td>
      <td class="sub"><?= e($c['last_used_at'] ?: '—')?></td>
      <td><?php if($c['status']==='active'):?><form method="post" style="display:inline"><?= csrf_field()?>
        <input type="hidden" name="action" value="cred_revoke"><input type="hidden" name="cred_id" value="<?= (int)$c['id']?>">
        <button class="btn btn-sm btn-danger">Revoke</button></form><?php endif;?></td></tr>
    <?php endforeach;?></tbody></table></div>
  <?php endif; ?>
  <form method="post" style="margin-top:12px"><?= csrf_field() ?><input type="hidden" name="action" value="cred_generate">
    <div class="field" style="max-width:280px"><label>Label</label><input name="label" placeholder="OBS controller" required></div>
    <div class="scope-grid">
      <?php foreach(Camera::SCOPES as $s=>$desc):?>
        <label class="chk"><input type="checkbox" name="scopes[<?= e($s)?>]" value="1"> <span class="mono"><?= e($s)?></span> <span class="sub"><?= e($desc)?></span></label>
      <?php endforeach;?>
    </div>
    <div style="margin-top:10px"><button class="btn btn-primary">Generate API key</button></div>
  </form>
</div>

<!-- Recordings & snapshots -->
<div class="panel cols2">
  <div>
    <h2>Recordings</h2>
    <?php if(!$recs):?><div class="note">No recordings yet.</div><?php else:?>
    <div class="table-wrap"><table><thead><tr><th>File</th><th>Status</th><th>Duration</th></tr></thead><tbody>
      <?php foreach($recs as $r):?><tr><td class="mono" style="font-size:12px"><?= e($r['filename'])?></td>
        <td><span class="badge <?= $r['status']==='ready'?'active':''?>"><?= e($r['status'])?></span></td>
        <td><?= $r['duration_s']?e($r['duration_s']).'s':'—'?></td></tr><?php endforeach;?>
    </tbody></table></div><?php endif;?>
  </div>
  <div>
    <h2>Snapshots</h2>
    <form method="post" style="margin-bottom:10px"><?= csrf_field()?><input type="hidden" name="action" value="snapshot">
      <button class="btn">📸 Capture snapshot</button></form>
    <?php if(!$snaps):?><div class="note">No snapshots yet.</div><?php else:?>
    <div class="table-wrap"><table><thead><tr><th>File</th><th>Taken</th></tr></thead><tbody>
      <?php foreach($snaps as $s):?><tr><td class="mono" style="font-size:12px"><?= e($s['filename'])?></td><td class="sub"><?= e($s['taken_at'])?></td></tr><?php endforeach;?>
    </tbody></table></div><?php endif;?>
  </div>
</div>

<?php page_foot();
