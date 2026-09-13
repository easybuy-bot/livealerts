<?php
declare(strict_types=1);
require_once __DIR__ . '/inc/layout.php';

$products = db()->query("SELECT * FROM products WHERE active=1 ORDER BY sort_order ASC, id ASC")->fetchAll();
$emoji = ['overlay' => '💬', 'script' => '🧩', 'tool' => '🛠️'];

page_head('Store');
?>
<section class="hero">
  <span class="pill">✨ <?= e(SITE_TAGLINE) ?></span>
  <h1>Level up your stream with <span>premium OBS overlays</span></h1>
  <p>Beautiful, animated chat overlays, scripts and stream tools. Log in, activate your API key, drop one URL into OBS — done. No purchases happen on this site; your access key is issued to you directly.</p>
  <div class="hero-cta">
    <a class="btn btn-primary" href="<?= e(url(current_user() ? 'dashboard.php' : 'register.php')) ?>">Get started →</a>
    <a class="btn btn-ghost" href="#store">Browse the store</a>
  </div>
</section>

<section class="sec" id="store">
  <div class="sec-h">
    <div><h2>The store</h2><p>Everything you can activate with an API key from the admin.</p></div>
  </div>
  <?php if (!$products): ?>
    <div class="note">No products yet. The admin can add overlays, scripts and tools from the admin panel.</div>
  <?php else: ?>
  <div class="grid">
    <?php foreach ($products as $p): ?>
      <a class="card" href="<?= e(url('product.php?slug=' . urlencode($p['slug']))) ?>">
        <div class="thumb">
          <?php if (!empty($p['image'])): ?><img src="<?= e($p['image']) ?>" alt="">
          <?php else: ?><span class="emoji"><?= $emoji[$p['category']] ?? '💜' ?></span><?php endif; ?>
        </div>
        <div class="body">
          <span class="tag <?= e($p['category']) ?>"><?= e($p['category']) ?></span>
          <h3><?= e($p['title']) ?></h3>
          <p><?= e($p['short_desc']) ?></p>
          <div class="foot">
            <span class="price"><?= e($p['price_label']) ?></span>
            <span class="btn btn-ghost btn-sm">View →</span>
          </div>
        </div>
      </a>
    <?php endforeach; ?>
  </div>
  <?php endif; ?>
</section>

<section class="sec" id="how">
  <div class="sec-h"><div><h2>How it works</h2><p>From key to live overlay in under a minute.</p></div></div>
  <div class="steps">
    <div class="step"><div class="n">1</div><h4>Create your account</h4><p>Sign up and log in to your personal dashboard.</p></div>
    <div class="step"><div class="n">2</div><h4>Activate your API key</h4><p>The admin issues you a unique key. Paste it into your dashboard to unlock your overlay.</p></div>
    <div class="step"><div class="n">3</div><h4>Set your chat source</h4><p>Connect your YouTube live stream (or run in demo mode) and customise the look.</p></div>
    <div class="step"><div class="n">4</div><h4>Add to OBS</h4><p>Copy your unique Browser Source URL into OBS. Only your key powers your overlay.</p></div>
  </div>
</section>
<?php page_foot();
