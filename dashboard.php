<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/layout.php';
require_once __DIR__ . '/lib/Overlay.php';
require_once __DIR__ . '/lib/Camera.php';
$u = require_login();
if ($u['role'] === 'admin') redirect('admin/index.php');

$err = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'redeem') {
    csrf_check();
    $code = strtoupper(trim((string)($_POST['key_code'] ?? '')));
    try {
        // Dispatch by product kind: camera keys provision a studio, everything
        // else provisions a chat/custom overlay (unchanged behaviour).
        $kind = key_product_kind($code);
        if ($kind === 'youtube_live') {
            $pdo = db();
            $st = $pdo->prepare("UPDATE access_keys SET user_id=?, activated_at=COALESCE(activated_at,NOW()) WHERE key_code=? AND (user_id IS NULL OR user_id=?) AND status='active'");
            $st->execute([(int)$u['id'], $code, (int)$u['id']]);
            audit('redeem_youtube_live_key', $code);
            flash('YouTube Live Alerts activated!');
            redirect('youtube-live.php');
        } elseif ($kind === 'camera') {
            $r = Camera::redeem($code, (int)$u['id']);
            audit('redeem_key', $code);
            flash($r['new'] ? 'Camera key activated! Your studio is ready.' : 'This key is already activated on your account.');
            redirect('camera.php?id=' . $r['studio_id']);
        } else {
            $r = Overlay::redeem($code, (int)$u['id']);
            audit('redeem_key', $code);
            flash($r['new'] ? 'API key activated! Your overlay is ready.' : 'This key is already activated on your account.');
            redirect('overlay.php?id=' . $r['overlay_id']);
        }
    } catch (Throwable $ex) { $err = $ex->getMessage(); }
}

/** Look up the product kind for a key code (null if unknown key). */
function key_product_kind(string $code): ?string {
    $st = db()->prepare('SELECT p.kind FROM access_keys k JOIN products p ON p.id=k.product_id WHERE k.key_code=? LIMIT 1');
    $st->execute([$code]);
    $row = $st->fetch();
    return $row ? (string)$row['kind'] : null;
}

$overlays = Overlay::forUser((int)$u['id']);
$studios  = Camera::studiosForUser((int)$u['id']);
page_head('Dashboard');
?>
<div class="sec-h"><div><h2>Hi, <?= e($u['name']) ?> 👋</h2><p>Activate a key or manage your overlays below.</p></div></div>

<div class="panel">
  <h2>Activate an API key</h2>
  <p class="sub">Paste the key the admin sent you. Each key unlocks exactly one overlay for one person.</p>
  <?php if ($err): ?><div class="err"><?= e($err) ?></div><?php endif; ?>
  <form method="post" class="row" style="align-items:flex-end">
    <?= csrf_field() ?>
    <input type="hidden" name="action" value="redeem">
    <div class="field" style="flex:2;margin:0"><label>API key</label>
      <input type="text" name="key_code" placeholder="OVH-XXXX-XXXX-XXXX-XXXX" required style="font-family:ui-monospace,monospace"></div>
    <div style="flex:0"><button class="btn btn-primary">Activate</button></div>
  </form>
</div>

<div class="panel">
  <h2>Your overlays</h2>
  <p class="sub">One API key = one overlay = one person. Add each overlay's URL as a Browser Source in OBS.</p>
  <?php if (!$overlays): ?>
    <div class="note">No overlays yet. Activate an API key above to create your first one.</div>
  <?php else: ?>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Overlay</th><th>Mode</th><th>API key</th><th>Source</th><th>Status</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($overlays as $o):
        $expired = $o['expires_at'] !== null && strtotime($o['expires_at']) < time();
        $status = $expired ? 'expired' : $o['key_status'];
        $omode = Overlay::modeOf($o);
        $oenabled = (int)($o['enabled'] ?? 1) === 1; ?>
        <tr>
          <td><strong><?= e($o['name'] ?: $o['product_title']) ?></strong><br>
              <span class="tag <?= e($o['category']) ?>"><?= e($o['category']) ?></span>
              <?php if (!$oenabled): ?> <span class="badge expired">Disabled</span><?php endif; ?></td>
          <td><span class="tag"><?= $o['product_kind']==='custom' ? 'custom' : e(ucfirst($omode)) ?></span></td>
          <td class="mono" style="font-size:13px"><?= e($o['key_code']) ?></td>
          <td><?= $o['source_type'] === 'youtube' ? 'YouTube live' : 'Demo mode' ?></td>
          <td><span class="badge <?= e($status) ?>"><?= e(ucfirst($status)) ?></span></td>
          <td style="text-align:right"><a class="btn btn-ghost btn-sm" href="<?= e(url('overlay.php?id=' . $o['id'])) ?>">Manage →</a></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <?php endif; ?>
</div>

<?php if ($studios): ?>
<div class="panel">
  <h2>Your camera studios 🎥</h2>
  <p class="sub">Live Camera Studio turns a DJI / RTMP camera into one clean OBS Browser Source.</p>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Studio</th><th>API key</th><th>OBS output</th><th>Status</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($studios as $s):
        $expired = $s['expires_at'] !== null && strtotime($s['expires_at']) < time();
        $status = $expired ? 'expired' : $s['key_status']; ?>
        <tr>
          <td><strong><?= e($s['name']) ?></strong><br><span class="tag camera">camera</span>
            <?php if ((int)$s['enabled'] !== 1): ?> <span class="badge expired">Disabled</span><?php endif; ?></td>
          <td class="mono" style="font-size:13px"><?= e($s['key_code']) ?></td>
          <td><a href="<?= e(url('obs.php?t=' . $s['obs_token'])) ?>" target="_blank">Open output ↗</a></td>
          <td><span class="badge <?= e($status) ?>"><?= e(ucfirst($status)) ?></span></td>
          <td style="text-align:right"><a class="btn btn-ghost btn-sm" href="<?= e(url('camera.php?id=' . $s['id'])) ?>">Manage →</a></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</div>
<?php endif; ?>
<?php page_foot();
