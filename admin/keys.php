<?php
declare(strict_types=1);
require_once __DIR__ . '/inc.php';
$pdo = db();
$u = require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = $_POST['action'] ?? '';
    if ($action === 'create') {
        $productId = (int)($_POST['product_id'] ?? 0);
        $email = strtolower(trim((string)($_POST['user_email'] ?? '')));
        $days = (int)($_POST['expires_days'] ?? 0);
        $note = trim((string)($_POST['note'] ?? '')) ?: null;
        $qty = max(1, min(50, (int)($_POST['qty'] ?? 1)));
        $userId = null;
        if ($email !== '') {
            $s = $pdo->prepare('SELECT id FROM users WHERE email=?'); $s->execute([$email]);
            $row = $s->fetch();
            if (!$row) { flash('No user found with that email. Key(s) not created.'); redirect('admin/keys.php'); }
            $userId = (int)$row['id'];
        }
        $prod = $pdo->prepare('SELECT id FROM products WHERE id=?'); $prod->execute([$productId]);
        if (!$prod->fetch()) { flash('Choose a valid product.'); redirect('admin/keys.php'); }
        $expires = $days > 0 ? date('Y-m-d H:i:s', time() + $days * 86400) : null;
        $ins = $pdo->prepare('INSERT INTO access_keys (key_code,product_id,user_id,note,expires_at,created_by) VALUES (?,?,?,?,?,?)');
        $created = [];
        for ($i = 0; $i < $qty; $i++) {
            do { $code = gen_key(); try { $ins->execute([$code,$productId,$userId,$note,$expires,(int)$u['id']]); $created[] = $code; break; }
                 catch (PDOException $e) { if ($e->getCode() !== '23000') throw $e; } } while (true);
        }
        audit('create_key', implode(',', $created));
        flash(count($created) . ' key(s) created: ' . implode('  ', $created));
        redirect('admin/keys.php');
    }
    $kid = (int)($_POST['key_id'] ?? 0);
    if ($action === 'suspend') { $pdo->prepare("UPDATE access_keys SET status='suspended' WHERE id=?")->execute([$kid]); flash('Key suspended.'); }
    if ($action === 'activate') { $pdo->prepare("UPDATE access_keys SET status='active' WHERE id=?")->execute([$kid]); flash('Key re-activated.'); }
    if ($action === 'delete')  { $pdo->prepare("DELETE FROM access_keys WHERE id=?")->execute([$kid]); flash('Key deleted (its overlay was removed).'); }
    redirect('admin/keys.php');
}

$products = $pdo->query("SELECT id,title FROM products WHERE is_activatable=1 AND active=1 ORDER BY sort_order")->fetchAll();
$keys = $pdo->query("SELECT k.*, p.title pt, u.email ue, (SELECT COUNT(*) FROM overlays o WHERE o.access_key_id=k.id) ov
                     FROM access_keys k JOIN products p ON p.id=k.product_id
                     LEFT JOIN users u ON u.id=k.user_id ORDER BY k.id DESC")->fetchAll();
admin_head('API keys', 'keys');
?>
<div class="panel">
  <h2>Issue a new API key</h2>
  <p class="sub">Each key unlocks exactly one overlay for one person. Assign to a user's email, or leave blank to let them claim it once.</p>
  <?php if (!$products): ?><div class="note">Add an activatable overlay product first.</div><?php else: ?>
  <form method="post" class="row" style="align-items:flex-end">
    <?= csrf_field() ?><input type="hidden" name="action" value="create">
    <div class="field" style="margin:0"><label>Product (overlay)</label>
      <select name="product_id" required><?php foreach ($products as $p): ?><option value="<?= $p['id'] ?>"><?= e($p['title']) ?></option><?php endforeach; ?></select></div>
    <div class="field" style="margin:0"><label>Assign to user email <span class="hint">(optional)</span></label>
      <input type="email" name="user_email" placeholder="user@example.com"></div>
    <div class="field" style="margin:0;max-width:130px"><label>Expires (days)</label>
      <input type="number" name="expires_days" min="0" value="0" title="0 = never"></div>
    <div class="field" style="margin:0;max-width:90px"><label>Qty</label>
      <input type="number" name="qty" min="1" max="50" value="1"></div>
    <div style="flex:0"><button class="btn btn-primary">Create key</button></div>
  </form>
  <?php endif; ?>
</div>

<div class="panel">
  <h2>All keys (<?= count($keys) ?>)</h2>
  <?php if (!$keys): ?><div class="note">No keys yet.</div><?php else: ?>
  <div class="table-wrap"><table>
    <thead><tr><th>Key</th><th>Product</th><th>Assigned</th><th>Overlay</th><th>Expires</th><th>Status</th><th></th></tr></thead>
    <tbody>
    <?php foreach ($keys as $k):
      $expired = $k['expires_at'] && strtotime($k['expires_at']) < time();
      $status = $expired && $k['status']==='active' ? 'expired' : $k['status']; ?>
      <tr>
        <td class="mono" style="font-size:13px"><?= e($k['key_code']) ?></td>
        <td><?= e($k['pt']) ?></td>
        <td><?= e($k['ue'] ?: '—') ?></td>
        <td><?= $k['ov'] ? '✅ created' : '<span class="mut">not yet</span>' ?></td>
        <td><?= $k['expires_at'] ? e(date('Y-m-d', strtotime($k['expires_at']))) : 'Never' ?></td>
        <td><span class="badge <?= e($status) ?>"><?= e(ucfirst($status)) ?></span></td>
        <td style="text-align:right;white-space:nowrap">
          <form method="post" style="display:inline"><?= csrf_field() ?><input type="hidden" name="key_id" value="<?= $k['id'] ?>">
          <?php if ($k['status'] === 'active'): ?>
            <button class="btn btn-ghost btn-sm" name="action" value="suspend">Suspend</button>
          <?php else: ?>
            <button class="btn btn-ghost btn-sm" name="action" value="activate">Activate</button>
          <?php endif; ?>
          <button class="btn btn-danger btn-sm" name="action" value="delete" onclick="return confirm('Delete this key and its overlay?')">Delete</button>
          </form>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody></table></div>
  <?php endif; ?>
</div>
<?php admin_foot();
