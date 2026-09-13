(async function () {
  await App.requireAuth();
  App.nav('Media');

  const $ = (id) => document.getElementById(id);
  let filter = 'all';
  let picked = [];          // File[] waiting to upload
  let maxMb = 50;

  /** Guess the media group from the browser's MIME type, with a filename fallback. */
  function detectKind(file) {
    const t = (file.type || '').toLowerCase();
    const n = (file.name || '').toLowerCase();
    if (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(n)) return 'sound';
    if (t.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v)$/.test(n)) return 'video';
    if (t === 'image/gif' || n.endsWith('.gif')) return 'gif';
    return 'image';
  }

  const mb = (bytes) => (bytes / 1024 / 1024);

  function showPicked() {
    const btn = $('upload-btn');
    if (!picked.length) {
      $('picked').textContent = '';
      btn.disabled = true;
      btn.textContent = 'Upload';
      return;
    }
    // Reject oversized files up front instead of after a long failed upload.
    const tooBig = picked.filter((f) => mb(f.size) > maxMb);
    picked = picked.filter((f) => mb(f.size) <= maxMb);
    if (tooBig.length) App.toast(`${tooBig.length} file(s) skipped — over ${maxMb} MB`, 'error');
    if (!picked.length) return showPicked();

    $('kind').value = detectKind(picked[0]);
    $('picked').innerHTML = picked
      .map((f) => `${App.esc(f.name)} <span class="muted">(${mb(f.size).toFixed(1)} MB)</span>`)
      .join(' · ');
    btn.disabled = false;
    btn.textContent = picked.length > 1 ? `Upload ${picked.length} files` : 'Upload';
  }

  async function load() {
    const d = await App.api('/api/media');
    if (d.limits?.maxUploadMb) {
      maxMb = d.limits.maxUploadMb;
      $('limit-hint').textContent =
        `PNG, JPG, GIF, WebP, MP4, WebM, MP3, WAV — up to ${maxMb} MB each. You can pick several at once.`;
    }
    const grid = $('grid');
    const items = d.media.filter((m) => filter === 'all' || m.kind === filter);
    if (!items.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1;"><div class="big">📁</div>
        ${filter === 'all' ? 'No media yet — drop a file above to get started.' : 'Nothing in this group yet.'}
        <div class="hint">Uploads show up as options inside the Alert Builder (backgrounds, images and sounds).</div></div>`;
      return;
    }
    grid.innerHTML = items.map((m) => `
      <div class="tpl-card">
        <div class="preview" style="aspect-ratio:1/1; display:flex; align-items:center; justify-content:center;">
          ${m.kind === 'sound'
            ? '<div style="font-size:48px;">🔊</div>'
            : `<img src="${App.esc(m.url)}" alt="${App.esc(m.filename)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=font-size:48px;>📄</div>'" />`}
        </div>
        <div class="meta">
          <div class="name" style="font-size:13px; word-break:break-all;">${App.esc(m.filename)}</div>
          <div class="row" style="gap:6px;">
            <span class="badge gray">${App.esc(m.kind)}</span>
            <span class="muted small">${((m.size || 0) / 1024).toFixed(0)} KB</span>
          </div>
          <div class="actions">
            <button class="btn small ghost copy" data-url="${App.esc(m.url)}">Copy URL</button>
            <button class="btn small danger del" data-id="${m.id}">Delete</button>
          </div>
        </div>
      </div>`).join('');
    grid.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', () => {
      App.copy(b.dataset.url, 'Media URL copied');
    }));
    grid.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this media? Alerts using it will fall back to no media.')) return;
      await App.api('/api/media/' + b.dataset.id, { method: 'DELETE' });
      App.toast('Deleted'); load();
    }));
  }

  $('kind-chips').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    $('kind-chips').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    filter = c.dataset.k;
    load();
  }));

  // ── Drag & drop + click-to-browse ──────────────────────────────────────
  const zone = $('dropzone');
  zone.addEventListener('click', () => $('file').click());
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('drag');
  }));
  zone.addEventListener('drop', (e) => {
    picked = [...(e.dataTransfer?.files || [])];
    showPicked();
  });
  $('file').addEventListener('change', (e) => {
    picked = [...e.target.files];
    showPicked();
  });

  $('upload-btn').addEventListener('click', async () => {
    if (!picked.length) return App.toast('Choose a file first', 'error');
    const btn = $('upload-btn');
    btn.disabled = true;
    const kind = $('kind').value;
    let done = 0;
    for (const file of picked) {
      btn.textContent = `Uploading ${done + 1} of ${picked.length}…`;
      const fd = new FormData();
      fd.append('file', file);
      // One picker can hold mixed types, so only the first file uses the dropdown.
      fd.append('kind', done === 0 ? kind : detectKind(file));
      try {
        const res = await fetch('/api/media', { method: 'POST', credentials: 'same-origin', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        done++;
      } catch (e) { App.toast(`${file.name}: ${e.message}`, 'error'); }
    }
    if (done) App.toast(done > 1 ? `${done} files uploaded` : 'Uploaded', 'success');
    picked = [];
    $('file').value = '';
    showPicked();
    load();
  });

  load();
})();
