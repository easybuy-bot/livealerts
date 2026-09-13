<?php
declare(strict_types=1);
require_once __DIR__ . '/inc.php';
$rows = db()->query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200")->fetchAll();
admin_head('Audit log', 'logs');
?>
<div class="panel">
  <h2>Recent activity</h2>
  <p class="sub">Non-secret operational events (logins, key issuance, redemptions).</p>
  <?php if (!$rows): ?><div class="note">Nothing logged yet.</div><?php else: ?>
  <div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead><tbody>
    <?php foreach ($rows as $r): ?>
      <tr><td class="mut" style="white-space:nowrap"><?= e($r['created_at']) ?></td>
      <td><?= e($r['actor']) ?></td><td><span class="tag"><?= e($r['action']) ?></span></td>
      <td class="mono" style="font-size:12px"><?= e(mb_strimwidth((string)$r['detail'],0,60,'…')) ?></td>
      <td class="mut"><?= e($r['ip']) ?></td></tr>
    <?php endforeach; ?>
    </tbody></table></div>
  <?php endif; ?>
</div>
<?php admin_foot();
