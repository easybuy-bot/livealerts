(async function () {
  await App.requireAuth();
  App.nav('Templates');

  const $ = (id) => document.getElementById(id);
  const EVENTS = ['SUBSCRIBER', 'SUPER_CHAT', 'SUPER_STICKER', 'NEW_MEMBER', 'GIFT_MEMBERSHIP', 'LIVE_START', 'LIVE_END', 'MILESTONE'];

  const SAMPLE = {
    SUBSCRIBER: { username: 'Rahul', profile_picture: '' },
    SUPER_CHAT: { username: 'Rahul', amount: '500', currency: 'INR', message: 'Amazing stream!' },
    SUPER_STICKER: { username: 'Rahul', amount: '200', currency: 'INR' },
    NEW_MEMBER: { username: 'Rahul', membership_level: 'Member' },
    GIFT_MEMBERSHIP: { username: 'Rahul', gift_count: '5' },
    GIFT_MEMBERSHIP_RECEIVED: { username: 'Rahul' },
    LIVE_START: { channel_name: 'My Channel', stream_title: 'Going live now!' },
    LIVE_END: { channel_name: 'My Channel' },
    MILESTONE: { subscriber_count: '10,000' },
  };

  // event filter options
  $('filter-event').innerHTML = '<option value="All">All events</option>' +
    EVENTS.map((e) => `<option value="${e}">${App.eventLabel(e)}</option>`).join('');

  // category chips — driven by the server so categories are never hardcoded here
  async function buildCategories() {
    let cats = [];
    try {
      const d = await App.api('/api/templates/categories');
      cats = d.categories || [];
    } catch { cats = []; }
    $('category-chips').innerHTML = ['All'].concat(cats).map((c) =>
      `<span class="chip ${c === 'All' ? 'active' : ''}" data-cat="${App.esc(c)}">${App.esc(c)}</span>`).join('');
    $('category-chips').querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
      $('category-chips').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      load();
    }));
  }

  function activeCategory() {
    return $('category-chips').querySelector('.chip.active')?.dataset.cat || 'All';
  }

  function lightweight(config) {
    const c = JSON.parse(JSON.stringify(config));
    c.sound = { source: null, volume: 0 };
    for (const l of c.layers || []) {
      if (l.type === 'particles' && l.style) l.style.count = Math.min(l.style.count || 20, 14);
    }
    if (c.background?.particles) c.background.particles.count = Math.min(c.background.particles.count || 20, 12);
    return c;
  }

  function renderPreview(el, tpl) {
    const vars = SAMPLE[tpl.eventType] || {};
    const config = lightweight(tpl.configuration);
    const ctrl = LiveAlerts.preview(el, config, vars);
    el._ctrl = ctrl;
  }

  // Shared card renderer so the main grid, Favorites and Recently Used all
  // behave identically (lazy animated previews + the same actions).
  function renderCards(container, templates) {
    container.innerHTML = '';
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target._rendered) {
          entry.target._rendered = true;
          const tpl = JSON.parse(entry.target.dataset.tpl);
          renderPreview(entry.target.querySelector('.preview'), tpl);
        }
      });
      // A generous margin means previews are already animating by the time the
      // card scrolls into view instead of popping in late.
    }, { rootMargin: '600px' });

    for (const tpl of templates) {
      const card = document.createElement('div');
      card.className = 'tpl-card';
      card.dataset.tpl = JSON.stringify(tpl);
      card.innerHTML = `
        <div class="preview"><div class="stage-inner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"></div></div>
        <div class="meta">
          <div class="row"><span class="name">${App.esc(tpl.name)}</span><button class="fav ${tpl.isFavorite ? 'on' : ''}" data-id="${tpl.id}" title="Favorite">${tpl.isFavorite ? '\u2665' : '\u2661'}</button></div>
          <div class="desc">${App.esc(tpl.description || '')}</div>
          <div class="row" style="gap:6px;">
            <span class="badge purple">${App.eventLabel(tpl.eventType)}</span>
            <span class="badge gray">${App.esc(tpl.orientation || '16:9')}</span>
            ${tpl.isPremium ? '<span class="badge amber">Premium</span>' : '<span class="badge green">Free</span>'}
          </div>
          <div class="tags">${(tpl.tags || []).slice(0, 4).map((t) => `<span>${App.esc(t)}</span>`).join('')}</div>
          <div class="actions">
            <button class="btn small use-btn" data-id="${tpl.id}">Use Template</button>
            <button class="btn small ghost preview-btn" data-id="${tpl.id}">Preview</button>
          </div>
        </div>`;
      container.appendChild(card);
      observer.observe(card);
    }

    container.querySelectorAll('.fav').forEach((b) => b.addEventListener('click', async () => {
      const on = b.classList.contains('on');
      try {
        await App.api(`/api/templates/${b.dataset.id}/favorite`, { method: on ? 'DELETE' : 'POST' });
        b.classList.toggle('on', !on);
        b.textContent = on ? '\u2661' : '\u2665';
        loadSections();
      } catch (e) { App.toast(e.message, 'error'); }
    }));

    container.querySelectorAll('.use-btn').forEach((b) => b.addEventListener('click', async () => {
      try {
        const d2 = await App.api(`/api/templates/${b.dataset.id}/use`, { method: 'POST', body: {} });
        window.location.href = '/builder.html?template=' + d2.template.id;
      } catch (e) { App.toast(e.message, 'error'); }
    }));

    container.querySelectorAll('.preview-btn').forEach((b) => b.addEventListener('click', () => {
      const tpl = JSON.parse(b.closest('.tpl-card').dataset.tpl);
      openDetail(tpl);
    }));
  }

  // "My Favorites" and "Recently Used" (spec 23 + 24)
  async function loadSections() {
    const host = $('sections');
    const [favs, recent] = await Promise.all([
      App.api('/api/templates/favorites').then((d) => d.templates).catch(() => []),
      App.api('/api/templates/recent').then((d) => d.templates).catch(() => []),
    ]);
    host.innerHTML = '';
    const blocks = [['My Favorites', favs], ['Recently Used', recent]];
    for (const [title, list] of blocks) {
      if (!list.length) continue;
      // Only one row each: these shortcuts should not push the actual library
      // below the fold.
      const shown = list.slice(0, 3);
      const wrap = document.createElement('section');
      wrap.style.marginBottom = '26px';
      wrap.innerHTML = `<h2 style="font-size:16px;margin:0 0 10px;">${title}
        <span class="muted" style="font-weight:400;font-size:13px;">${list.length > shown.length
          ? `(showing ${shown.length} of ${list.length})` : `(${list.length})`}</span></h2>
        <div class="grid cols-3"></div>`;
      host.appendChild(wrap);
      renderCards(wrap.querySelector('.grid'), shown.map((t) => ({
        ...t, isFavorite: title === 'My Favorites' ? true : t.isFavorite,
      })));
    }
  }

  async function load() {
    const params = new URLSearchParams();
    const cat = activeCategory();
    if (cat !== 'All') params.set('category', cat);
    const ev = $('filter-event').value;
    if (ev !== 'All') params.set('eventType', ev);
    const ori = $('filter-orientation').value;
    if (ori !== 'All') params.set('orientation', ori);
    const prem = $('filter-premium').value;
    if (prem !== 'all') params.set('premium', prem);
    params.set('sort', $('filter-sort').value);
    const q = $('search').value.trim();
    if (q) params.set('search', q);

    const d = await App.api('/api/templates?' + params.toString());
    $('empty').style.display = d.templates.length ? 'none' : '';
    renderCards($('grid'), d.templates);
  }

  function openDetail(tpl) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;display:flex;align-items:center;justify-content:center;padding:30px;';
    overlay.innerHTML = `
      <div class="card" style="max-width:760px;width:100%;">
        <div class="row" style="margin-bottom:14px;"><h2 style="font-size:19px;">${App.esc(tpl.name)}</h2><div class="spacer"></div><button class="btn ghost small" id="close">×</button></div>
        <div class="preview-stage" id="detail-preview" style="aspect-ratio:16/9;border-radius:10px;"></div>
        <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap;">
          <span class="badge purple">${App.eventLabel(tpl.eventType)}</span>
          <span class="badge gray">${App.esc(tpl.style || '')}</span>
          <span class="badge gray">${App.esc(tpl.orientation || '16:9')}</span>
          ${tpl.isPremium ? '<span class="badge amber">Premium</span>' : '<span class="badge green">Free</span>'}
        </div>
        <p class="muted" style="margin-top:12px;">${App.esc(tpl.description || '')}</p>
        <div style="margin-top:12px;">
          <span class="badge green">✓ Animated</span> <span class="badge green">✓ Dynamic text</span> <span class="badge green">✓ Sound</span> <span class="badge green">✓ Fully editable</span>
        </div>
        <button class="btn block" id="use-detail" style="margin-top:16px;">Use Template</button>
      </div>`;
    document.body.appendChild(overlay);
    const previewEl = overlay.querySelector('#detail-preview');
    const inner = document.createElement('div');
    inner.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
    previewEl.style.position = 'relative';
    previewEl.appendChild(inner);
    const ctrl = LiveAlerts.preview(inner, lightweight(tpl.configuration), SAMPLE[tpl.eventType] || {});
    overlay.querySelector('#close').addEventListener('click', () => { ctrl.destroy(); overlay.remove(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { ctrl.destroy(); overlay.remove(); } });
    overlay.querySelector('#use-detail').addEventListener('click', async () => {
      const d2 = await App.api(`/api/templates/${tpl.id}/use`, { method: 'POST', body: {} });
      window.location.href = '/builder.html?template=' + d2.template.id;
    });
  }

  let debounce;
  $('search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(load, 300); });
  $('filter-event').addEventListener('change', load);
  $('filter-orientation').addEventListener('change', load);
  $('filter-premium').addEventListener('change', load);
  $('filter-sort').addEventListener('change', load);

  (async function init() {
    await buildCategories();
    await load();
    loadSections();
  })();
})();
