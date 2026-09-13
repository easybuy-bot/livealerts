<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/helpers.php';

$log = [];
$fail = null;
try {
    $pdo = db();
    migrate($pdo);
    $log[] = 'Database tables created / verified.';

    // seed admin
    $n = (int)$pdo->query("SELECT COUNT(*) c FROM users WHERE role='admin'")->fetch()['c'];
    if ($n === 0) {
        $st = $pdo->prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)');
        $st->execute([SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, password_hash(SEED_ADMIN_PASSWORD, PASSWORD_DEFAULT), 'admin']);
        $log[] = 'Admin account created: ' . SEED_ADMIN_EMAIL;
    } else {
        $log[] = 'Admin account already exists (skipped).';
    }

    // seed sample products
    $c = (int)$pdo->query("SELECT COUNT(*) c FROM products")->fetch()['c'];
    if ($c === 0) {
        $seed = [
            ['neon-chat','Neon Chat Overlay','overlay','Animated transparent live-chat overlay with a glowing moving border.',
             "A premium OBS chat overlay for YouTube live streams. Transparent cards, animated shine border, Super Chat / member highlights and full customisation.",
             "Transparent, stream-safe design\nAnimated glowing perimeter\nSuper Chat & membership highlights\nHindi + emoji friendly\nFull colour, size and animation controls",'Included with your key',1,1,1],
            ['minimal-chat','Minimal Chat Overlay','overlay','Clean, distraction-free chat with subtle fade animations.',
             "A minimalist chat overlay that keeps the focus on your gameplay while showing recent messages cleanly.",
             "Ultra-light design\nFade / slide animations\nSpam & duplicate filtering\nAvatar + badge options",'Included with your key',1,1,2],
            ['follower-goal','Follower Goal Widget','tool','Animated goal bar for followers, subs or donations.',
             "A configurable goal-bar browser source you can point at your targets.",
             "Smooth animated progress\nCustom colours\nOBS browser source",'Contact for access',0,1,3],
            ['chat-mod-script','Chat Moderation Script','script','Auto-moderation helper script for keeping chat clean.',
             "A helper script that filters spam and blocked words before they hit your overlay.",
             "Blocked words & users\nSpam / duplicate limits\nLink hiding",'Contact for access',0,1,4],
        ];
        $ins = $pdo->prepare('INSERT INTO products (slug,title,category,short_desc,description,features,price_label,is_activatable,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)');
        foreach ($seed as $s) $ins->execute($s);
        $log[] = count($seed) . ' sample products added.';
    } else {
        $log[] = 'Products already present (skipped seeding).';
    }
} catch (Throwable $e) {
    $fail = $e->getMessage();
}
?><!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Install — <?= e(SITE_NAME) ?></title>
<link rel="stylesheet" href="assets/app.css"></head><body>
<main class="wrap main"><div class="auth" style="max-width:560px">
<div class="panel">
<h1><?= e(SITE_NAME) ?> installer</h1>
<?php if ($fail): ?>
  <div class="err">Install failed: <?= e($fail) ?></div>
  <p class="hint">Check your database settings in <span class="mono">config.php</span> and make sure the database exists.</p>
<?php else: ?>
  <div class="flash">Installation complete 🎉</div>
  <ul style="color:var(--mut)"><?php foreach ($log as $l): ?><li><?= e($l) ?></li><?php endforeach; ?></ul>
  <div class="note" style="margin:14px 0">
    <b>Admin login:</b> <?= e(SEED_ADMIN_EMAIL) ?><br>
    <b>Password:</b> <span class="mono"><?= e(SEED_ADMIN_PASSWORD) ?></span><br>
    <span class="hint">Change this in config.php / your profile after logging in.</span>
  </div>
  <a class="btn btn-primary btn-block" href="<?= e(url('admin/login.php')) ?>">Go to admin panel →</a>
  <p class="alt"><b>Important:</b> delete <span class="mono">install.php</span> after setup.</p>
<?php endif; ?>
</div></div></main></body></html>
