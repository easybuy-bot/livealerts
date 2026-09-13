<?php
declare(strict_types=1);
require_once __DIR__ . '/inc.php';
admin_head('Dashboard', 'dashboard');
$pdo = db();
$stat = fn($sql) => (int)$pdo->query($sql)->fetch()['c'];
$users = $stat("SELECT COUNT(*) c FROM users WHERE role='user'");
$products = $stat("SELECT COUNT(*) c FROM products");
$keysActive = $stat("SELECT COUNT(*) c FROM access_keys WHERE status='active'");
$keysTotal = $stat("SELECT COUNT(*) c FROM access_keys");
$overlays = $stat("SELECT COUNT(*) c FROM overlays");
$live = $stat("SELECT COUNT(*) c FROM overlays WHERE source_type='youtube'");
?>
<div class="stat-grid">
  <div class="stat"><div class="k">Users</div><div class="v"><?= $users ?></div></div>
  <div class="stat"><div class="k">Active keys</div><div class="v"><?= $keysActive ?><span style="font-size:15px;color:var(--mut)"> / <?= $keysTotal ?></span></div></div>
  <div class="stat"><div class="k">Overlays</div><div class="v"><?= $overlays ?></div></div>
  <div class="stat"><div class="k">YouTube-connected</div><div class="v"><?= $live ?></div></div>
  <div class="stat"><div class="k">Products</div><div class="v"><?= $products ?></div></div>
</div>
<div class="panel" style="margin-top:20px">
  <h2>Quick actions</h2>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
    <a class="btn btn-primary" href="<?= e(url('admin/keys.php')) ?>">＋ Issue a new API key</a>
    <a class="btn btn-ghost" href="<?= e(url('admin/products.php')) ?>">Add a product</a>
    <a class="btn btn-ghost" href="<?= e(url('admin/users.php')) ?>">Manage users</a>
  </div>
</div>
<div class="panel">
  <h2>Recently issued keys</h2>
  <?php
  $rows = $pdo->query("SELECT k.*, p.title pt, u.email ue FROM access_keys k
                       JOIN products p ON p.id=k.product_id
                       LEFT JOIN users u ON u.id=k.user_id
                       ORDER BY k.id DESC LIMIT 8")->fetchAll();
  if (!$rows): ?><div class="note">No keys issued yet.</div><?php else: ?>
  <div class="table-wrap"><table>
    <thead><tr><th>Key</th><th>Product</th><th>Assigned to</th><th>Status</th></tr></thead><tbody>
    <?php foreach ($rows as $r): ?>
      <tr><td class="mono" style="font-size:13px"><?= e($r['key_code']) ?></td>
      <td><?= e($r['pt']) ?></td>
      <td><?= e($r['ue'] ?: '— (unclaimed)') ?></td>
      <td><span class="badge <?= e($r['status']) ?>"><?= e(ucfirst($r['status'])) ?></span></td></tr>
    <?php endforeach; ?>
    </tbody></table></div>
  <?php endif; ?>
</div>
<?php admin_foot();
