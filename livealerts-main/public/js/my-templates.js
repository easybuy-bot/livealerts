/* My Templates — Edit / Duplicate / Preview / Rename / Delete (spec 25 + 26) */
(async function () {
  await App.requireAuth();
  App.nav('My Templates');

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

  $('filter-event').innerHTML = '<option value="All">All events</option>' +
    EVENTS.map((e) => `<option value="${e}">${App.eventLabel(e)}</option>`).join('');

  let all = [];

  function lightweight(config) {
    const c = JSON.parse(JSON.stringify(config || {}));
    c.sound = { source: null, volume: 0 };
    for (const l of c.layers || []) {
      if (l.type === 'particles' && l.style) l.style.count = Math.min(l.style.count || 20, 14);
    }
    if (c.background?.particles) c.background.particles.count = Math.min(c.background.particles.count || 20, 12);
    return c;
  }

  function visible() {
    const ev = $('filter-event').value;
    const q = $('search').value.trim().toLowerCase();
    return all.filter((t) =>
      (ev === 'All' || t.eventType === ev) &&
      (!q || (t.name || '').toLowerCase().includes(q)));
  }

  function render() {
    const list = visible();
    const grid = $('grid');
    grid.innerHTML = '';
    $('empty').style.display = list.length ? 'none' : '';

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target._rendered) {
          entry.target._rendered = true;
          const tpl = JSON.parse(entry.target.dataset.tpl);
          const el = entry.target.querySelector('.preview .stage-inner');
          entry.target._ctrl = LiveAlerts.preview(el, lightweight(tpl.configuration), SAMPLE[tpl.eventType] || {});
        }
      });
    }, { rootMargin: '200px' });

    for (const tpl of list) {
      const card = document.createElement('div');
      card.className = 'tpl-card';
      card.dataset.tpl = JSON.stringify(tpl);
      card.innerHTML = `
        <div class="preview"><div class="stage-inner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;"></div></div>
        <div class="meta">
          <div class="row"><span class="name">${App.esc(tpl.name)}</span></div>
          <div class="row" style="gap:6px;">
            <span class="badge purple">${App.eventLabel(tpl.eventType)}</span>
            <span class="badge gray">updated ${new Date(tpl.updatedAt).toLocaleDateString()}</span>
          </div>
          <div class="actions" style="flex-wrap:wrap;gap:6px;">
            <button class="btn small" data-act="edit" data-id="${tpl.id}">Edit</button>
            <button class="btn small ghost" data-act="rename" data-id="${tpl.id}">Rename</button>
            <button class="btn small ghost" data-act="duplicate" data-id="${tpl.id}">Duplicate</button>
            <button class="btn small ghost" data-act="test" data-id="${tpl.id}">Test</button>
            <button class="btn small ghost" data-act="delete" data-id="${tpl.id}" style="color:var(--red);">Delete</button>
          </div>
        </div>`;
      grid.appendChild(card);
      observer.observe(card);
    }

    grid.querySelectorAll('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => act(b.dataset.act, b.dataset.id)));
  }

  async function act(action, id) {
    const tpl = all.find((t) => t.id === id);
    if (!tpl) return;
    try {
      if (action === 'edit') {
        window.location.href = '/builder.html?template=' + id;
      } else if (action === 'rename') {
        const name = window.prompt('New name', tpl.name);
        if (!name || name.trim() === tpl.name) return;
        await App.api('/api/my-templates/' + id, { method: 'PUT', body: { name: name.trim() } });
        App.toast('Renamed', 'success');
        await load();
      } else if (action === 'duplicate') {
        await App.api('/api/my-templates/' + id + '/duplicate', { method: 'POST', body: {} });
        App.toast('Duplicated', 'success');
        await load();
      } else if (action === 'test') {
        await App.api('/api/my-templates/' + id + '/test', { method: 'POST', body: {} });
        App.toast('Test alert sent to your overlay', 'success');
      } else if (action === 'delete') {
        if (!window.confirm(`Delete "${tpl.name}"? This cannot be undone.`)) return;
        await App.api('/api/my-templates/' + id, { method: 'DELETE' });
        App.toast('Deleted', 'success');
        await load();
      }
    } catch (e) { App.toast(e.message, 'error'); }
  }

  async function load() {
    const d = await App.api('/api/my-templates');
    all = d.templates || [];
    render();
  }

  let debounce;
  $('search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(render, 200); });
  $('filter-event').addEventListener('change', render);

  await load();
})();