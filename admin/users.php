<?php
declare(strict_types=1);
require_once __DIR__ . '/inc.php';
$pdo = db();
$me = require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = $_POST['action'] ?? '';
    $uid = (int)($_POST['user_id'] ?? 0);
    if ($uid === (int)$me['id']) { flash('You cannot change your own account here.'); redirect('admin/users.php'); }
    if ($action === 'block')   { $pdo->prepare("UPDATE users SET status='blocked' WHERE id=?")->execute([$uid]); flash('User blocked.'); }
    if ($action === 'unblock') { $pdo->prepare("UPDATE users SET status='active' WHERE id=?")->execute([$uid]); flash('User unblocked.'); }
    if ($action === 'promote') { $pdo->prepare("UPDATE users SET role='admin' WHERE id=?")->execute([$uid]); flash('User promoted to admin.'); }
    if ($action === 'demote')  { $pdo->prepare("UPDATE users SET role='user' WHERE id=?")->execute([$uid]); flash('Admin demoted to user.'); }
    redirect('admin/users.php');
}

$rows = $pdo->query("SELECT u.*, (SELECT COUNT(*) FROM overlays o WHERE o.user_id=u.id) ov
                     FROM users u ORDER BY u.id DESC")->fetchAll();
admin_head('Users', 'users');
?>
<div class="panel">
  <h2>Users (<?= count($rows) ?>)</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Overlays</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>
    <?php foreach ($rows as $r): ?>
      <tr>
        <td><?= e($r['name']) ?></td>
        <td class="mono" style="font-size:13px"><?= e($r['email']) ?></td>
        <td><?= $r['role']==='admin' ? '<span class="badge active">Admin</span>' : 'User' ?></td>
        <td><?= (int)$r['ov'] ?></td>
        <td><span class="badge <?= $r['status']==='active'?'active':'blocked' ?>"><?= e(ucfirst($r['status'])) ?></span></td>
        <td class="mut"><?= e(date('Y-m-d', strtotime($r['created_at']))) ?></td>
        <td style="text-align:right;white-space:nowrap">
          <?php if ($r['id'] !== (int)$me['id']): ?>
          <form method="post" style="display:inline"><?= csrf_field() ?><input type="hidden" name="user_id" value="<?= $r['id'] ?>">
            <?php if ($r['status']==='active'): ?><button class="btn btn-ghost btn-sm" name="action" value="block">Block</button>
            <?php else: ?><button class="btn btn-ghost btn-sm" name="action" value="unblock">Unblock</button><?php endif; ?>
            <?php if ($r['role']==='user'): ?><button class="btn btn-ghost btn-sm" name="action" value="promote">Make admin</button>
            <?php else: ?><button class="btn btn-ghost btn-sm" name="action" value="demote">Make user</button><?php endif; ?>
          </form>
          <?php else: ?><span class="mut">You</span><?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody></table></div>
</div>
<?php admin_foot();
