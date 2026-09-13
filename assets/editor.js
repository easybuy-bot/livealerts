const O = window.OVERLAY;
// Custom overlays hand us their schema inline; the chat overlay fetches the shared file.
const schema = O.schema || await (await fetch(O.schemaUrl,{cache:'no-cache'})).json();
const defaults = Object.fromEntries(Object.entries(schema).map(([g,fs])=>[g,Object.fromEntries(Object.entries(fs).map(([k,f])=>[k,f.default]))]));

// merge saved settings over defaults so new fields never break older configs
let settings = structuredClone(defaults);
if (O.settings) for (const g of Object.keys(defaults)) if (O.settings[g]) Object.assign(settings[g], O.settings[g]);

const preview = document.getElementById('preview');
let ready = false;
window.addEventListener('message', e => { if (e.source === preview.contentWindow && e.origin === location.origin && e.data?.type === 'preview-ready') { ready = true; push(); } });
// The schema fetch above is awaited, so the preview can announce itself before this
// listener exists. Keep inviting it until it answers, then send the saved settings.
function pingPreview(){ try { preview.contentWindow.postMessage({type:'preview-init'},location.origin); } catch {} }
preview.addEventListener('load', pingPreview);
pingPreview();
let previewTries=0;
const previewPing=setInterval(()=>{ if(ready||++previewTries>40){clearInterval(previewPing);return;} pingPreview(); },250);
function push(){ if(ready) preview.contentWindow.postMessage({type:'settings',settings},location.origin); }

const label = k => k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
const controls = document.getElementById('controls');

// Groups are organised into top-level sections (Phase 24). Any schema group not
// listed here (e.g. a custom overlay's own groups) falls back to a "More" section.
const SECTIONS = [
  {title:'Chat', groups:['general','canvas','layout','horizontal','messageCard','typography','avatar','username','badges','timestamp','message','background','border','shine','glassShine','glow','animation','superChat','superSticker','membership','filters','behavior']},
  {title:'Media', groups:['media','mediaPlayer','mediaQueue','mediaModeration']},
  {title:'Members & roles', groups:['roleThemes','role_member','role_prime','role_vip','role_moderator','role_owner','role_superchat']},
  {title:'Events', groups:['eventRules']},
  {title:'Performance', groups:['performance','obs','advanced']},
];
const OPEN_BY_DEFAULT = ['general','layout','background','typography','media'];

// Build one <details> group of controls from the schema.
function buildGroup(group, fields, openDefault){
  const sec = document.createElement('details'); sec.className = 'grp'; if (openDefault) sec.open = true;
  const sum = document.createElement('summary'); sum.textContent = label(group.replace(/^role_/,'Role: ')); sec.appendChild(sum);
  const wrap = document.createElement('div'); wrap.className = 'grp-body'; sec.appendChild(wrap);
  for (const [key, f] of Object.entries(fields)) {
    const row = document.createElement('div'); row.className = 'ctl';
    const lab = document.createElement('label'); lab.textContent = f.label || label(key);
    let input;
    const val = settings[group][key];
    if (f.type === 'boolean') {
      input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!val;
      row.classList.add('ctl-bool');
      input.onchange = () => { settings[group][key] = input.checked; push(); };
    } else if (f.type === 'enum') {
      input = document.createElement('select');
      for (const opt of f.options) { const o = document.createElement('option'); o.value = opt; o.textContent = opt; if (opt === val) o.selected = true; input.appendChild(o); }
      input.onchange = () => { settings[group][key] = input.value; push(); };
    } else if (f.type === 'color') {
      input = document.createElement('input'); input.type = 'color'; input.value = val || '#ffffff';
      input.oninput = () => { settings[group][key] = input.value; push(); };
    } else if (f.type === 'number') {
      input = document.createElement('input'); input.type = 'range';
      input.min = f.min ?? 0; input.max = f.max ?? 100; input.step = f.step ?? 1; input.value = val;
      const out = document.createElement('span'); out.className = 'val'; out.textContent = val;
      input.oninput = () => { const n = Number(input.value); settings[group][key] = n; out.textContent = n; push(); };
      row.appendChild(lab); const line = document.createElement('div'); line.className='rangeline'; line.append(input,out); row.appendChild(line); wrap.appendChild(row); continue;
    } else {
      input = document.createElement('input'); input.type = 'text'; input.value = val ?? '';
      input.oninput = () => { settings[group][key] = input.value; push(); };
    }
    if (f.type === 'boolean') { row.append(input, lab); } else { row.append(lab, input); }
    wrap.appendChild(row);
  }
  return sec;
}

// Build every control from the current `settings`. Called on load and whenever
// settings are replaced wholesale (e.g. the Reset button).
function renderControls(){
  // Preserve the template preset bar (it lives at the top of the controls column);
  // clearing only the schema-generated groups keeps the 2-column editor grid intact.
  [...controls.children].forEach(c => { if (c.id !== 'presetBar') c.remove(); });
  const isChat = ('general' in schema) && ('layout' in schema);
  if (!isChat) { // custom overlay — keep the original flat layout
    let first = true;
    for (const [group, fields] of Object.entries(schema)) { controls.appendChild(buildGroup(group, fields, first || OPEN_BY_DEFAULT.includes(group))); first = false; }
    return;
  }
  const placed = new Set();
  for (const sec of SECTIONS) {
    const groups = sec.groups.filter(g => g in schema); if (!groups.length) continue;
    const h = document.createElement('div'); h.className = 'sec-head'; h.textContent = sec.title; controls.appendChild(h);
    for (const g of groups) { placed.add(g); controls.appendChild(buildGroup(g, schema[g], OPEN_BY_DEFAULT.includes(g))); }
  }
  const rest = Object.keys(schema).filter(g => !placed.has(g) && g !== 'preset');
  if (rest.length) { const h = document.createElement('div'); h.className='sec-head'; h.textContent='More'; controls.appendChild(h); for (const g of rest) controls.appendChild(buildGroup(g, schema[g], false)); }
}
renderControls();

// ---- Template presets (Phase v4.2 — "Premium Shine Glass" and friends) ----
// Each preset is a partial settings bundle deep-merged over the current design.
// They only apply to the chat overlay (which owns these groups); custom overlays
// keep their own flat schema and never see this toolbar.
const R = k => ({radiusTopLeft:k,radiusTopRight:k,radiusBottomRight:k,radiusBottomLeft:k});
const PRESETS = {
  'premium-glass': {
    preset:{template:'premium-glass'},
    layout:{mode:'vertical',alignment:'bottom',horizontal:'left',gap:12,paddingX:14,paddingY:14},
    general:{maxMessages:9},
    messageCard:{enabled:true,paddingX:15,paddingY:12},
    background:{type:'glass',color:'#0a0c14',opacity:0.55,blur:14},
    border:{enabled:true,width:1,style:'solid',color:'#ffffff',opacity:0.14,...R(22)},
    message:{color:'#eef0ff'},
    username:{show:true,colorMode:'auto',weight:700,size:14},
    timestamp:{show:true,color:'#b9b6c8',opacity:0.8,size:11},
    avatar:{show:true,shape:'circle',size:44,borderWidth:0},
    typography:{textShadow:true,lineHeight:1.4},
    glow:{shadowEnabled:true,shadowColor:'#000000',shadowOpacity:0.45,shadowBlur:22,shadowX:0,shadowY:8},
    shine:{enabled:false},
    glassShine:{mode:'continuous',color:'#ffffff',opacity:0.22,width:15,angle:18,duration:1200,period:7,specialOnlyRoles:true},
    roleThemes:{enabled:true},
    badges:{owner:false,moderator:false,member:false},
    role_member:{badgeText:''},role_moderator:{badgeText:''},
    role_owner:{enabled:true,badgeText:'',backgroundType:'glass',background:'#1a1430',backgroundOpacity:0.6,borderColor:'#e0b53c',shine:true,shineColor:'#ffd76a'},
    role_vip:{enabled:true,badgeText:'',backgroundType:'gradient',background:'#2a1150',gradientColor:'#5a2a9a',backgroundOpacity:0.6,borderColor:'#b98bff',shine:true,shineColor:'#d9c2ff'},
    role_superchat:{enabled:true,backgroundType:'gradient',background:'#12233f',gradientColor:'#274a86',backgroundOpacity:0.7,borderColor:'#6fb6ff',shine:true,shineColor:'#bfe0ff'},
  },
  'purple-cosmic': {
    preset:{template:'purple-cosmic'},
    layout:{mode:'vertical',alignment:'bottom',horizontal:'left',gap:12,paddingX:14,paddingY:14},
    general:{maxMessages:9},
    messageCard:{enabled:true,paddingX:15,paddingY:12},
    background:{type:'glass',color:'#100a20',opacity:0.55,blur:16},
    border:{enabled:true,width:1,style:'solid',color:'#b98bff',opacity:0.22,...R(24)},
    message:{color:'#efe8ff'},
    username:{show:true,colorMode:'auto',weight:700,size:14},
    timestamp:{show:true,color:'#c3b6e6',opacity:0.85,size:11},
    avatar:{show:true,shape:'circle',size:46,borderWidth:0},
    typography:{textShadow:true,lineHeight:1.4},
    glow:{shadowEnabled:true,shadowColor:'#2a0f4d',shadowOpacity:0.5,shadowBlur:26,shadowX:0,shadowY:6},
    shine:{enabled:false},
    glassShine:{mode:'periodic',color:'#d9c2ff',opacity:0.3,width:16,angle:20,duration:1200,period:5,specialOnlyRoles:true},
    roleThemes:{enabled:true},
    badges:{owner:false,moderator:false,member:false},
    role_member:{badgeText:''},role_moderator:{badgeText:''},
    role_superchat:{enabled:true,backgroundType:'image',backgroundImage:'assets/img/cosmic-blue.png',background:'#0c1836',backgroundOpacity:0.85,backgroundImageOpacity:0.55,backgroundImageSize:'cover',backgroundImagePosition:'center',borderColor:'#6fb6ff',borderWidth:1,glow:true,glowColor:'#3b6fd6',glowBlur:20,textColor:'#eaf3ff',usernameColor:'#9fd0ff',shine:true,shineColor:'#cfe6ff'},
    role_owner:{enabled:true,badgeText:'',backgroundType:'image',backgroundImage:'assets/img/cosmic-purple.png',background:'#1a0d33',backgroundOpacity:0.85,backgroundImageOpacity:0.6,backgroundImageSize:'cover',backgroundImagePosition:'center',borderColor:'#c79bff',borderWidth:1,glow:true,glowColor:'#7a3ecb',glowBlur:22,textColor:'#f3ecff',usernameColor:'#d9b8ff',shine:true,shineColor:'#e6d2ff'},
    role_vip:{enabled:true,badgeText:'',backgroundType:'image',backgroundImage:'assets/img/cosmic-purple.png',background:'#170a2e',backgroundOpacity:0.8,backgroundImageOpacity:0.5,backgroundImageSize:'cover',backgroundImagePosition:'center',borderColor:'#b98bff',borderWidth:1,glow:true,glowColor:'#6a2fb0',glowBlur:18,textColor:'#efe6ff',usernameColor:'#cbb0ff',shine:true,shineColor:'#ddc8ff'},
  },
  'neon': {
    preset:{template:'neon'},
    layout:{mode:'vertical',alignment:'bottom',horizontal:'left',gap:10,paddingX:12,paddingY:12},
    general:{maxMessages:10},
    messageCard:{enabled:true,paddingX:14,paddingY:11},
    background:{type:'glass',color:'#05070f',opacity:0.6,blur:10},
    border:{enabled:true,width:1.5,style:'solid',color:'#19e5ff',opacity:0.5,...R(14)},
    message:{color:'#eafcff'},
    username:{show:true,colorMode:'fixed',color:'#19e5ff',weight:800,size:14},
    timestamp:{show:true,color:'#7fe9ff',opacity:0.8,size:11},
    avatar:{show:true,shape:'circle',size:42,borderWidth:0},
    typography:{textShadow:true,lineHeight:1.35},
    glow:{shadowEnabled:true,shadowColor:'#0bb6d6',shadowOpacity:0.5,shadowBlur:22,shadowX:0,shadowY:0},
    shine:{enabled:true,color:'#19e5ff'},
    glassShine:{mode:'continuous',color:'#5ff3ff',opacity:0.3,width:14,angle:16,duration:1000,period:5,specialOnlyRoles:true},
    roleThemes:{enabled:true},
    badges:{owner:false,moderator:false,member:false},
    role_member:{badgeText:''},role_moderator:{badgeText:''},
    role_owner:{enabled:true,badgeText:'',backgroundType:'glass',background:'#0a1420',backgroundOpacity:0.6,borderColor:'#ff5cf0',shine:true,shineColor:'#ff5cf0'},
    role_vip:{enabled:true,badgeText:'',backgroundType:'glass',background:'#0a1420',backgroundOpacity:0.6,borderColor:'#a56bff',shine:true,shineColor:'#c79bff'},
    role_superchat:{enabled:true,backgroundType:'glass',background:'#08131f',backgroundOpacity:0.65,borderColor:'#19e5ff',shine:true,shineColor:'#8ff6ff'},
  },
  'dark-glass': {
    preset:{template:'dark-glass'},
    layout:{mode:'vertical',alignment:'bottom',horizontal:'left',gap:10,paddingX:12,paddingY:12},
    general:{maxMessages:10},
    messageCard:{enabled:true,paddingX:14,paddingY:11},
    background:{type:'glass',color:'#0b0d13',opacity:0.5,blur:12},
    border:{enabled:true,width:1,style:'solid',color:'#ffffff',opacity:0.08,...R(16)},
    message:{color:'#e7e9f0'},
    username:{show:true,colorMode:'auto',weight:700,size:14},
    timestamp:{show:true,color:'#9aa0b0',opacity:0.7,size:11},
    avatar:{show:true,shape:'circle',size:42,borderWidth:0},
    typography:{textShadow:true,lineHeight:1.4},
    glow:{shadowEnabled:true,shadowColor:'#000000',shadowOpacity:0.4,shadowBlur:18,shadowX:0,shadowY:6},
    shine:{enabled:false},
    glassShine:{mode:'off'},
    roleThemes:{enabled:false},
  },
};
function applyPreset(name){
  const b = PRESETS[name]; if (!b) return;
  // A preset changes the VISUAL theme only — never the overlay's structural layout
  // mode (vertical/horizontal), which is chosen per overlay. Preserve it so presets
  // work correctly on horizontal overlays too.
  const keepMode = settings.layout && settings.layout.mode;
  for (const g of Object.keys(b)) { if (!settings[g]) settings[g] = {}; Object.assign(settings[g], structuredClone(b[g])); }
  if (keepMode && settings.layout) settings.layout.mode = keepMode;
  renderControls(); push();
}
(function buildPresetBar(){
  const isChat = ('general' in schema) && ('layout' in schema); if (!isChat || !('preset' in schema)) return;
  const st = document.createElement('style');
  st.textContent = '.preset-bar{margin:0 0 10px}.preset-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.preset-btn.active{outline:2px solid #8b6cff;background:rgba(139,108,255,.18);color:#fff}';
  document.head.appendChild(st);
  const bar = document.createElement('div'); bar.className = 'preset-bar'; bar.id = 'presetBar';
  const h = document.createElement('div'); h.className = 'sec-head'; h.textContent = 'Template preset';
  const row = document.createElement('div'); row.className = 'preset-row';
  const items = [['premium-glass','Premium Glass'],['purple-cosmic','Purple Cosmic'],['neon','Neon'],['dark-glass','Dark Glass'],['custom','Custom']];
  function markActive(k){ for (const b of row.children) b.classList.toggle('active', b.dataset.preset === k); }
  for (const [key,lab] of items) {
    const btn = document.createElement('button'); btn.type='button'; btn.className='btn btn-ghost btn-sm preset-btn'; btn.textContent=lab; btn.dataset.preset=key;
    btn.onclick = () => { if (key !== 'custom') applyPreset(key); else { settings.preset.template='custom'; push(); } markActive(key); };
    row.appendChild(btn);
  }
  bar.append(h, row);
  // Keep the preset bar INSIDE the controls column (as its first child) so the
  // editor stays a clean two-column grid (controls | preview).
  controls.insertBefore(bar, controls.firstChild);
  markActive((settings.preset && settings.preset.template) || 'custom');
})();

function postPreview(msg){ try { preview.contentWindow.postMessage(msg, location.origin); } catch {} }
const btnSample = document.getElementById('btnSample');
if (btnSample) {
  btnSample.onclick = () => {
    const kinds = ['Normal','Owner','Moderator','Member','Super Chat','Hindi','Emoji','Long Message'];
    postPreview({type:'sample',kind:kinds[Math.floor(Math.random()*kinds.length)]});
  };
  // Quick sample chips for the new features (Phase 22). These use safe, well-known
  // test URLs so a design can be tried without a live chat message.
  const extras = [['YouTube','YouTube'],['Shorts','YouTube Shorts'],['Member','Member'],['Prime','Prime'],['VIP','VIP'],['Super Chat','Super Chat'],['Image','Image'],['Long msg','Long Message']];
  const frag = document.createDocumentFragment();
  for (const [text, kind] of extras) { const b = document.createElement('button'); b.type='button'; b.className='btn btn-ghost btn-sm'; b.textContent=text; b.onclick=()=>postPreview({type:'sample',kind}); frag.appendChild(b); }
  const q = document.createElement('button'); q.type='button'; q.className='btn btn-ghost btn-sm'; q.textContent='Media queue'; q.onclick=()=>postPreview({type:'mediaqueue'}); frag.appendChild(q);
  const clr = document.createElement('button'); clr.type='button'; clr.className='btn btn-ghost btn-sm'; clr.textContent='Clear'; clr.onclick=()=>postPreview({type:'clear'}); frag.appendChild(clr);
  const bar = btnSample.parentElement; if (bar) bar.insertBefore(frag, btnSample.nextSibling);
}

async function saveSettings(){
  const r = await fetch(O.saveUrl, {method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({token:O.token, _csrf:O.csrf, settings})});
  const j = await r.json();
  return !!j.ok;
}

const btnSave = document.getElementById('btnSave');
btnSave.onclick = async () => {
  btnSave.disabled = true; btnSave.textContent = 'Saving…';
  try { btnSave.textContent = (await saveSettings()) ? 'Saved ✓' : 'Error'; }
  catch { btnSave.textContent = 'Error'; }
  setTimeout(()=>{ btnSave.textContent='Save design'; btnSave.disabled=false; }, 1400);
};

// Reset every design setting to its schema default, refresh the controls and
// preview, then persist so the change reaches OBS immediately.
const btnReset = document.getElementById('btnReset');
if (btnReset) btnReset.onclick = async () => {
  if (!confirm('Reset every design setting back to its default? This replaces your current customisations.')) return;
  const keepMode = settings.layout && settings.layout.mode;   // don't flip this overlay's layout on reset
  settings = structuredClone(defaults);
  if (keepMode && settings.layout) settings.layout.mode = keepMode;
  renderControls();
  push();
  btnReset.disabled = true; btnReset.textContent = 'Resetting…';
  let ok = false; try { ok = await saveSettings(); } catch {}
  btnReset.textContent = ok ? 'Reset ✓' : 'Reset (save failed)';
  setTimeout(()=>{ btnReset.textContent='Reset'; btnReset.disabled=false; }, 1600);
};
