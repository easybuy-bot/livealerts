<?php
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';

function page_head(string $title, bool $appNav = false): void {
    $u = current_user();
    $name = SITE_NAME;
    ?><!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= e($title) ?> — <?= e($name) ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?= e(url('assets/app.css')) ?>?v=<?= @filemtime(__DIR__ . '/../assets/app.css') ?: '1' ?>">
</head>
<body>
<header class="nav">
  <div class="wrap nav-in">
    <a class="brand" href="<?= e(url('index.php')) ?>"><span class="brand-dot"></span><?= e($name) ?></a>
    <nav class="nav-links">
      <a href="<?= e(url('index.php')) ?>">Store</a>
      <a href="<?= e(url('index.php#how')) ?>">How it works</a>
      <?php if ($u): ?>
        <a href="<?= e(url('dashboard.php')) ?>">Dashboard</a>
        <a class="btn btn-ghost" href="<?= e(url('logout.php')) ?>">Log out</a>
      <?php else: ?>
        <a href="<?= e(url('login.php')) ?>">Log in</a>
        <a class="btn btn-primary" href="<?= e(url('register.php')) ?>">Sign up</a>
      <?php endif; ?>
    </nav>
  </div>
</header>
<main class="wrap main">
<?php if ($f = flash()): ?><div class="flash"><?= e($f) ?></div><?php endif; ?>
<?php }

function page_foot(): void { ?>
</main>
<footer class="foot">
  <div class="wrap foot-in">
    <div>© <?= date('Y') ?> <?= e(SITE_NAME) ?>. All rights reserved.</div>
    <div class="foot-links">
      <a href="<?= e(url('index.php')) ?>">Store</a>
      <a href="<?= e(url('login.php')) ?>">Account</a>
    </div>
  </div>
</footer>
</body></html>
<?php }
