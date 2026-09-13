const c = document.getElementById('overlay-config');
// The page supplies the renderer's file version, so a cached copy is never reused.
const {Renderer, sample} = await import('./renderer.js?v=' + encodeURIComponent(c.dataset.assetV || 'waapi-v3'));
const status = document.getElementById('status');
const renderer = new Renderer(document.getElementById('chat'), JSON.parse(c.dataset.settings));
// Exposed so the media player/queue can be driven from an interaction window,
// stream-deck bridge or the dashboard preview (OBS output itself isn't clickable
// by viewers — see docs). Safe read/control surface, no secrets.
try { window.overlayRenderer = renderer; } catch {}

function fit(){ const s=renderer.settings; const scale=Math.min(1, innerWidth/s.general.width);
  renderer.root.style.transform=`scale(${scale*s.general.scale})`; }
fit(); window.addEventListener('resize', fit);

if (c.dataset.ok !== '1') { status.textContent = 'Overlay unavailable. Check your key and activation in the dashboard.'; }
else {
  const token = c.dataset.token, endpoint = c.dataset.poll;
  let cursor = 0, delay = 3000, stopped = false, demoTick = null;
  // Only re-apply settings when they actually change, otherwise every poll would
  // rebuild the message cards and restart the travelling-shine animation.
  let settingsSig = JSON.stringify(JSON.parse(c.dataset.settings));

  function setStatus(t){ const s = renderer.settings;
    if (s.obs?.hideStatus) { status.textContent=''; return; } status.textContent = t || ''; }

  async function poll(){
    if (stopped) return;
    try {
      const r = await fetch(`${endpoint}?t=${encodeURIComponent(token)}&since=${cursor}`, {cache:'no-store'});
      const j = await r.json();
      if (j.settings) { const sig = JSON.stringify(j.settings); if (sig !== settingsSig) { settingsSig = sig; renderer.apply(j.settings); } }
      if (j.mode === 'demo') { startDemo(); return; }
      stopDemo();
      if (typeof j.cursor === 'number') cursor = j.cursor;
      if (Array.isArray(j.messages)) for (const m of j.messages) renderer.event({type:'chat_message', data:m});
      delay = Math.min(15000, Math.max(1500, j.pollMs || 3000));
      setStatus(j.state === 'offline' ? (renderer.settings.behavior?.offline==='custom' ? renderer.settings.behavior.offlineText : 'Waiting for your next live stream.') : '');
    } catch { delay = Math.min(delay * 1.5, 15000); }
    setTimeout(poll, delay);
  }
  function startDemo(){ if (demoTick) return; setStatus('');
    const kinds=['Normal','Owner','Moderator','Member','Super Chat','Hindi','Emoji'];
    demoTick = setInterval(()=>renderer.add(sample(kinds[Math.floor(Math.random()*kinds.length)])), 2600);
    renderer.add(sample('Owner'));
  }
  function stopDemo(){ if (demoTick){ clearInterval(demoTick); demoTick=null; } }
  poll();
  window.addEventListener('pagehide', ()=>{ stopped=true; stopDemo(); renderer.destroy(); });
}
