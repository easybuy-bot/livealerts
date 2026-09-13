<?php
declare(strict_types=1);
require_once __DIR__ . '/inc.php';
require_once __DIR__ . '/../lib/Camera.php';
$pdo = db();
$me = require_admin();

$viewId = (int)($_GET['id'] ?? 0);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = $_POST['action'] ?? '';
    $sid = (int)($_POST['studio_id'] ?? 0);
    switch ($action) {
        case 'toggle':
            $flag = (string)($_POST['flag'] ?? '');
            $allowed = ['enabled','recording_enabled','ai_blur_enabled','webrtc_enabled'];
            if (in_array($flag, $allowed, true)) {
                $pdo->prepare("UPDATE camera_studios SET $flag = 1 - $flag WHERE id=?")->execute([$sid]);
                audit('admin_camera_toggle', $flag . ' studio ' . $sid);
                flash('Setting updated.');
            }
            break;
        case 'limits':
            $pdo->prepare("UPDATE camera_studios SET max_devices=?, max_scenes=?, max_bitrate_kbps=? WHERE id=?")
                ->execute([
                    max(1, (int)($_POST['max_devices'] ?? 4)),
                    max(1, (int)($_POST['max_scenes'] ?? 12)),
                    max(500, (int)($_POST['max_bitrate_kbps'] ?? 8000)),
                    $sid,
                ]);
            audit('admin_camera_limits', 'studio ' . $sid);
            flash('Limits saved.');
            break;
        case 'revoke_cred':
            $cid = (int)($_POST['cred_id'] ?? 0);
            $pdo->prepare("UPDATE camera_credentials SET status='revoked' WHERE id=? AND studio_id=?")->execute([$cid, $sid]);
            audit('admin_camera_revoke_cred', 'cred ' . $cid);
            flash('Credential revoked.');
            break;
        case 'end_stream':
            $stid = (int)($_POST['stream_id'] ?? 0);
            $pdo->prepare("UPDATE camera_streams SET status='ended', ended_at=NOW() WHERE id=? AND studio_id=?")->execute([$stid, $sid]);
            audit('admin_camera_end_stream', 'stream ' . $stid);
            flash('Stream ended.');
            break;
    }
    redirect('admin/camera.php' . ($sid ? ('?id=' . $sid) : ''));
}

/* ---- Detail view ---- */
if ($viewId) {
    $s = $pdo->prepare("SELECT cs.*, u.name AS owner_name, u.email AS owner_email, k.key_code, k.status AS key_status
                        FROM camera_studios cs
                        JOIN users u ON u.id=cs.user_id
                        JOIN access_keys k ON k.id=cs.access_key_id WHERE cs.id=? LIMIT 1");
    $s->execute([$viewId]);
    $studio = $s->fetch();
    if (!$studio) { admin_head('Camera studio', 'cameras'); echo '<div class="panel"><h2>Studio not found</h2><a class="btn" href="'.e(url('admin/camera.php')).'">← Back</a></div>'; admin_foot(); exit; }

    $devs = $pdo->prepare("SELECT * FROM camera_devices WHERE studio_id=? ORDER BY id"); $devs->execute([$viewId]); $devices = $devs->fetchAll();
    $scn = $pdo->prepare("SELECT * FROM camera_scenes WHERE studio_id=? ORDER BY sort_order,id"); $scn->execute([$viewId]); $scenes = $scn->fetchAll();
    $cr = $pdo->prepare("SELECT * FROM camera_credentials WHERE studio_id=? ORDER BY id"); $cr->execute([$viewId]); $creds = $cr->fetchAll();
    $strm = $pdo->prepare("SELECT st.*, d.name AS device_name FROM camera_streams st JOIN camera_devices d ON d.id=st.device_id WHERE st.studio_id=? ORDER BY st.id DESC LIMIT 20"); $strm->execute([$viewId]); $streams = $strm->fetchAll();

    admin_head('Camera: ' . $studio['name'], 'cameras');
    ?>
    <div class="panel">
      <h2>🎥 <?= e($studio['name']) ?></h2>
      <p class="sub">Owner <b><?= e($studio['owner_name']) ?></b> · <span class="mono"><?= e($studio['owner_email']) ?></span>
         · key <span class="mono"><?= e($studio['key_code']) ?></span></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <?php foreach (['enabled'=>'Studio enabled','recording_enabled'=>'Recording','ai_blur_enabled'=>'AI face blur','webrtc_enabled'=>'WebRTC'] as $flag=>$lbl): ?>
          <form method="post" style="display:inline"><?= csrf_field() ?>
            <input type="hidden" name="action" value="toggle"><input type="hidden" name="studio_id" value="<?= $viewId ?>">
            <input type="hidden" name="flag" value="<?= e($flag) ?>">
            <button class="btn btn-ghost btn-sm"><?= e($lbl) ?>: <b><?= ((int)$studio[$flag])?'ON':'OFF' ?></b></button>
          </form>
        <?php endforeach; ?>
      </div>
      <form method="post" class="row" style="align-items:flex-end;flex-wrap:wrap"><?= csrf_field() ?>
        <input type="hidden" name="action" value="limits"><input type="hidden" name="studio_id" value="<?= $viewId ?>">
        <div class="field" style="margin:0;max-width:130px"><label>Max cameras</label><input name="max_devices" value="<?= (int)$studio['max_devices'] ?>"></div>
        <div class="field" style="margin:0;max-width:130px"><label>Max scenes</label><input name="max_scenes" value="<?= (int)$studio['max_scenes'] ?>"></div>
        <div class="field" style="margin:0;max-width:160px"><label>Max bitrate (kbps)</label><input name="max_bitrate_kbps" value="<?= (int)$studio['max_bitrate_kbps'] ?>"></div>
        <div><button class="btn btn-primary">Save limits</button></div>
      </form>
      <p class="sub" style="margin-top:12px">OBS token: <span class="mono"><?= e(substr($studio['obs_token'],0,10)) ?>…</span>
         · <a href="<?= e(url('obs.php?t='.$studio['obs_token'])) ?>" target="_blank">Open output ↗</a></p>
    </div>

    <div class="panel">
      <h2>Cameras (<?= count($devices) ?>) · Scenes (<?= count($scenes) ?>)</h2>
      <div class="table-wrap"><table><thead><tr><th>Camera</th><th>Type</th><th>Path</th><th>Status</th></tr></thead><tbody>
        <?php foreach($devices as $d):?><tr><td><?= e($d['name'])?></td><td><span class="tag"><?= e($d['device_type'])?></span></td>
          <td class="mono" style="font-size:12px"><?= e($d['stream_path'])?></td>
          <td><span class="badge <?= $d['status']==='streaming'?'active':''?>"><?= e($d['status'])?></span></td></tr><?php endforeach;?>
        <?php if(!$devices):?><tr><td colspan="4" class="mut">No cameras.</td></tr><?php endif;?>
      </tbody></table></div>
    </div>

    <div class="panel">
      <h2>Credentials</h2>
      <div class="table-wrap"><table><thead><tr><th>Kind</th><th>Label</th><th>Prefix</th><th>Scopes</th><th>Status</th><th></th></tr></thead><tbody>
        <?php foreach($creds as $c):?><tr>
          <td><span class="tag"><?= e($c['kind'])?></span></td><td><?= e($c['label'])?></td>
          <td class="mono"><?= e($c['secret_prefix'])?>…</td><td class="mut" style="font-size:12px"><?= e($c['scopes']?:'—')?></td>
          <td><span class="badge <?= $c['status']==='active'?'active':'blocked'?>"><?= e($c['status'])?></span></td>
          <td style="text-align:right"><?php if($c['status']==='active'):?><form method="post" style="display:inline"><?= csrf_field()?>
            <input type="hidden" name="action" value="revoke_cred"><input type="hidden" name="studio_id" value="<?= $viewId?>"><input type="hidden" name="cred_id" value="<?= (int)$c['id']?>">
            <button class="btn btn-ghost btn-sm">Revoke</button></form><?php endif;?></td></tr><?php endforeach;?>
      </tbody></table></div>
    </div>

    <div class="panel">
      <h2>Recent stream sessions</h2>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Camera</th><th>Status</th><th>Started</th><th></th></tr></thead><tbody>
        <?php foreach($streams as $st):?><tr><td>#<?= (int)$st['id']?></td><td><?= e($st['device_name'])?></td>
          <td><span class="badge <?= in_array($st['status'],['live','starting'])?'active':''?>"><?= e($st['status'])?></span></td>
          <td class="mut"><?= e($st['started_at']?:'—')?></td>
          <td style="text-align:right"><?php if(in_array($st['status'],['live','starting'])):?><form method="post" style="display:inline"><?= csrf_field()?>
            <input type="hidden" name="action" value="end_stream"><input type="hidden" name="studio_id" value="<?= $viewId?>"><input type="hidden" name="stream_id" value="<?= (int)$st['id']?>">
            <button class="btn btn-ghost btn-sm">End</button></form><?php endif;?></td></tr><?php endforeach;?>
        <?php if(!$streams):?><tr><td colspan="5" class="mut">No sessions.</td></tr><?php endif;?>
      </tbody></table></div>
    </div>
    <p><a class="btn btn-ghost" href="<?= e(url('admin/camera.php')) ?>">← All studios</a></p>
    <?php admin_foot(); exit;
}

/* ---- List view ---- */
$rows = $pdo->query("SELECT cs.*, u.name AS owner_name, u.email AS owner_email, k.key_code, k.status AS key_status,
                        (SELECT COUNT(*) FROM camera_devices d WHERE d.studio_id=cs.id) devs,
                        (SELECT COUNT(*) FROM camera_scenes sc WHERE sc.studio_id=cs.id) scns,
                        (SELECT COUNT(*) FROM camera_streams st WHERE st.studio_id=cs.id AND st.status IN ('live','starting')) live
                     FROM camera_studios cs
                     JOIN users u ON u.id=cs.user_id
                     JOIN access_keys k ON k.id=cs.access_key_id
                     ORDER BY cs.id DESC")->fetchAll();
$tot = [
    'studios' => count($rows),
    'devices' => (int)$pdo->query("SELECT COUNT(*) c FROM camera_devices")->fetch()['c'],
    'live'    => (int)$pdo->query("SELECT COUNT(*) c FROM camera_streams WHERE status IN ('live','starting')")->fetch()['c'],
    'recs'    => (int)$pdo->query("SELECT COUNT(*) c FROM camera_recordings")->fetch()['c'],
];
admin_head('Cameras', 'cameras');
?>
<div class="panel">
  <h2>Live Camera Studios</h2>
  <p class="sub">All provisioned camera studios across the platform.</p>
  <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px">
    <?php foreach(['studios'=>'Studios','devices'=>'Cameras','live'=>'Live now','recs'=>'Recordings'] as $k=>$lbl):?>
      <div style="flex:1;min-width:120px;background:#120e20;border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:26px;font-weight:800"><?= (int)$tot[$k]?></div><div class="mut" style="font-size:13px"><?= $lbl?></div></div>
    <?php endforeach;?>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Studio</th><th>Owner</th><th>Cams</th><th>Scenes</th><th>Live</th><th>Flags</th><th>Key</th><th></th></tr></thead><tbody>
    <?php foreach($rows as $r):?><tr>
      <td><strong><?= e($r['name'])?></strong><?php if(!(int)$r['enabled']):?> <span class="badge blocked">Disabled</span><?php endif;?></td>
      <td class="mut" style="font-size:13px"><?= e($r['owner_email'])?></td>
      <td><?= (int)$r['devs']?></td><td><?= (int)$r['scns']?></td>
      <td><?= (int)$r['live']? '<span class="badge active">'.(int)$r['live'].'</span>' : '0' ?></td>
      <td class="mut" style="font-size:12px"><?= (int)$r['recording_enabled']?'REC ':''?><?= (int)$r['ai_blur_enabled']?'BLUR ':''?><?= (int)$r['webrtc_enabled']?'RTC':''?></td>
      <td class="mono" style="font-size:12px"><?= e($r['key_code'])?></td>
      <td style="text-align:right"><a class="btn btn-ghost btn-sm" href="<?= e(url('admin/camera.php?id='.$r['id']))?>">Manage →</a></td>
    </tr><?php endforeach;?>
    <?php if(!$rows):?><tr><td colspan="8" class="mut">No camera studios yet. Issue a Live Camera Studio key from <a href="<?= e(url('admin/keys.php'))?>">API keys</a>.</td></tr><?php endif;?>
  </tbody></table></div>
</div>
<?php admin_foot();
