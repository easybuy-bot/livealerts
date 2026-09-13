<?php
declare(strict_types=1);
require_once __DIR__ . '/../inc/helpers.php';
$cur = current_user();
if ($cur && $cur['role'] === 'admin') redirect('admin/index.php');
$err = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $email = strtolower(trim((string)($_POST['email'] ?? '')));
    $pass = (string)($_POST['password'] ?? '');
    $st = db()->prepare("SELECT * FROM users WHERE email=? AND role='admin' AND status='active' LIMIT 1");
    $st->execute([$email]);
    $u = $st->fetch();
    if ($u && password_verify($pass, $u['password_hash'])) { login_user($u); audit('admin_login', $email); redirect('admin/index.php'); }
    $err = 'Invalid admin credentials.';
}
?><!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin login — <?= e(SITE_NAME) ?></title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?= e(url('assets/app.css')) ?>"></head>
<body><main class="wrap main"><div class="auth"><div class="panel">
<h1>Admin panel</h1><p class="sub">Separate secure login for staff only.</p>
<?php if ($err): ?><div class="err"><?= e($err) ?></div><?php endif; ?>
<form method="post"><?= csrf_field() ?>
<div class="field"><label>Email</label><input type="email" name="email" required></div>
<div class="field"><label>Password</label><input type="password" name="password" required></div>
<button class="btn btn-primary btn-block">Log in</button></form>
<div class="alt"><a href="<?= e(url('index.php')) ?>">← Back to store</a></div>
</div></div></main></body></html>
