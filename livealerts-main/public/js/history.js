(async function () {
  await App.requireAuth();
  App.nav('History');

  const $ = (id) => document.getElementById(id);
  const EVENTS = ['SUBSCRIBER', 'SUPER_CHAT', 'SUPER_STICKER', 'NEW_MEMBER', 'MEMBER_MILESTONE', 'GIFT_MEMBERSHIP', 'GIFT_MEMBERSHIP_RECEIVED', 'LIVE_START', 'LIVE_END', 'MILESTONE'];
  $('filter-event').innerHTML = '<option value="">All events</option>' + EVENTS.map((e) => `<option value="${e}">${App.eventLabel(e)}</option>`).join('');

  let rows = [];

  /** "2 min ago" style stamps read faster than full dates in a long list. */
  function ago(iso) {
    const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return 'just now';
    const units = [[60, 'min'], [24, 'hr'], [7, 'day'], [4.4, 'week']];
    let v = secs / 60;
    for (const [step, label] of units) {
      if (v < step) return `${Math.floor(v)} ${label}${Math.floor(v) === 1 ? '' : 's'} ago`;
      v /= step;
    }
    return new Date(iso).toLocaleDateString();
  }

  async function loadStats() {
    const d = await App.api('/api/events/analytics');
    const a = d.analytics;
    $('s-total').textContent = a.total || 0;
    $('s-subs').textContent = a.subscribers || 0;
    $('s-chats').textContent = a.super_chats || 0;
    $('s-rev').textContent = '₹' + (a.revenue || 0);
  }

  async function load() {
    const ev = $('filter-event').value;
    const q = ev ? '?eventType=' + ev + '&limit=200' : '?limit=200';
    const d = await App.api('/api/events' + q);
    rows = d.events;
    $('export-btn').disabled = !rows.length;
    $('rows').innerHTML = d.events.length
      ? d.events.map((e) => `
        <tr>
          <td><span class="badge purple">${App.eventLabel(e.eventType)}</span></td>
          <td><strong>${App.esc(e.username || '—')}</strong></td>
          <td>${e.amount != null ? `${e.amount} ${App.esc(e.currency || '')}` : '—'}</td>
          <td class="muted">${App.esc(e.message || '')}</td>
          <td class="muted small" title="${App.esc(new Date(e.createdAt).toLocaleString())}">${ago(e.createdAt)}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" class="empty" style="text-align:center;">
          <div class="big">📭</div>
          ${ev ? 'No ' + App.eventLabel(ev) + ' events yet.' : 'No events yet.'}
          <div class="hint">Events land here automatically while you are live. Want to see it work now?
            Send a test alert from the <a href="/builder.html">Alert Builder</a>.</div>
        </td></tr>`;
  }

  $('export-btn').addEventListener('click', () => {
    if (!rows.length) return App.toast('Nothing to export');
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Event,User,Amount,Currency,Message,Time']
      .concat(rows.map((e) => [
        App.eventLabel(e.eventType), e.username || '', e.amount ?? '',
        e.currency || '', e.message || '', new Date(e.createdAt).toISOString(),
      ].map(esc).join(',')))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `livealerts-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    App.toast(`Exported ${rows.length} events`, 'success');
  });

  $('filter-event').addEventListener('change', load);
  loadStats(); load();
})();
