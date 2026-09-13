<?php
declare(strict_types=1);
require_once __DIR__ . '/../inc/helpers.php';

function admin_head(string $title, string $active): void {
    $u = require_admin();
    $nav = [
        'dashboard' => ['index.php', '📊 Dashboard'],
        'keys'      => ['keys.php', '🔑 API keys'],
        'products'  => ['products.php', '🧩 Products'],
        'cameras'   => ['camera.php', '🎥 Cameras'],
        'users'     => ['users.php', '👥 Users'],
        'logs'      => ['logs.php', '📝 Audit log'],
    ];
    ?><!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title><?= e($title) ?> — Admin</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= e(url('assets/app.css')) ?>?v=<?= @filemtime(__DIR__ . '/../assets/app.css') ?: '1' ?>"></head><body>
    <div class="admin-shell">
      <aside class="admin-side">
        <a class="brand" href="<?= e(url('admin/index.php')) ?>"><span class="brand-dot"></span><?= e(SITE_NAME) ?></a>
        <div class="section-title">Manage</div>
        <?php foreach ($nav as $k => $v): ?>
          <a class="<?= $k === $active ? 'active' : '' ?>" href="<?= e(url('admin/' . $v[0])) ?>"><?= $v[1] ?></a>
        <?php endforeach; ?>
        <div class="section-title">Account</div>
        <a href="<?= e(url('index.php')) ?>">↗ View store</a>
        <a href="<?= e(url('admin/logout.php')) ?>">Log out</a>
      </aside>
      <main class="admin-main">
        <div class="admin-top"><h1><?= e($title) ?></h1><div class="mut"><?= e($u['name']) ?></div></div>
        <?php if ($f = flash()): ?><div class="flash"><?= e($f) ?></div><?php endif; ?>
<?php }

function admin_foot(): void { echo '</main></div></body></html>'; }
