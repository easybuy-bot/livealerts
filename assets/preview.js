const ASSET_V=new URLSearchParams(location.search).get('v')||'waapi-v4';
const {Renderer,sample}=await import('./renderer.js?v='+encodeURIComponent(ASSET_V));
const schema=await(await fetch('./settings.schema.json?v='+encodeURIComponent(ASSET_V),{cache:'no-cache'})).json();
const defaults=Object.fromEntries(Object.entries(schema).map(([g,fs])=>[g,Object.fromEntries(Object.entries(fs).map(([k,f])=>[k,f.default]))]));
let settings=structuredClone(defaults);

// A "camera" that frames the overlay inside the OBS canvas, so Width, Height,
// Scale, Opacity, Alignment, Canvas size and Preview background are all visible.
const chat=document.getElementById('chat');
const canvasFrame=document.createElement('div');
canvasFrame.id='canvas-frame';
canvasFrame.style.cssText='position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform';
document.body.appendChild(canvasFrame);
canvasFrame.appendChild(chat);                       // renderer anchors #chat to this frame's corners
const bounds=document.createElement('div');          // dashed outline showing the overlay's box
bounds.id='overlay-bounds';
bounds.style.cssText='position:absolute;pointer-events:none;border:2px dashed rgba(255,255,255,.4);border-radius:6px;box-sizing:border-box;z-index:1';
canvasFrame.appendChild(bounds);

// Interactive preview: the media player mounts inside the canvas frame so it
// scales with the preview camera, and cards are clickable to open the player.
const renderer=new Renderer(chat,settings,{mediaRoot:canvasFrame,interactive:true});

const notice=document.createElement('div');
notice.style.cssText='position:absolute;top:12px;left:12px;right:12px;color:#cfc9dc;font:12px/1.5 system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.65);z-index:9';
document.body.append(notice);

const isHex=v=>typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v);

function fit(){
 const g=settings.general,l=settings.layout,cvs=settings.canvas;
 const cw=Math.max(1,cvs.width||1920),ch=Math.max(1,cvs.height||1080);
 const vw=Math.max(1,innerWidth),vh=Math.max(1,innerHeight);
 const fw=Math.max(1,g.width),fh=Math.max(1,g.height);
 // Zoom from the design size (not the scaled footprint) so the Scale control
 // still visibly grows/shrinks the overlay instead of being cancelled out.
 let zoom=0.86*Math.min(vw/fw,vh/fh);
 zoom=Math.max(0.04,Math.min(zoom,1.4));
 const footW=fw*g.scale,footH=fh*g.scale;             // on-canvas footprint
 const cx=l.horizontal==='right'?cw-footW/2:footW/2;  // footprint centre in canvas coords
 const cy=l.alignment==='top'?footH/2:ch-footH/2;
 const tx=vw/2-cx*zoom,ty=vh/2-cy*zoom;               // centre that footprint in the viewport
 canvasFrame.style.width=cw+'px';canvasFrame.style.height=ch+'px';
 canvasFrame.style.background=isHex(cvs.previewBackground)?cvs.previewBackground:'#171322';
 canvasFrame.style.transform=`translate(${tx}px,${ty}px) scale(${zoom})`;
 Object.assign(bounds.style,{width:footW+'px',height:footH+'px',
  left:l.horizontal==='left'?'0':'auto',right:l.horizontal==='right'?'0':'auto',
  top:l.alignment==='top'?'0':'auto',bottom:l.alignment==='bottom'?'0':'auto',
  borderWidth:Math.max(1,1.4/zoom)+'px'});            // keep the outline ~1.4px on screen at any zoom
 notice.textContent='Sample preview — overlay '+Math.round(g.width)+'×'+Math.round(g.height)
   +' inside '+cw+'×'+ch+' canvas'
   +(!settings.shine.enabled?' · Shine OFF':renderer.motionReduced()?' · Reduced motion ON: dot stationary':'');
}

const modeIsH=()=>settings.layout&&settings.layout.mode==='horizontal';
// Route through renderer.add() so each layout (vertical stack / horizontal conveyor)
// places the samples through its real lifecycle instead of the vertical path only.
function seed(){for(const kind of ['Normal','Owner','Member','Super Chat']){renderer.add(sample(kind));}
 if(!modeIsH())for(const item of renderer.items)item.life=0;}
// In horizontal mode cards travel off-screen, so keep the preview lively with a heartbeat.
let demoTimer=null;const kinds=['Normal','Owner','Moderator','Member','Super Chat','Hindi','Emoji'];
function startHeartbeat(){stopHeartbeat();if(modeIsH())demoTimer=setInterval(()=>renderer.add(sample(kinds[Math.floor(Math.random()*kinds.length)])),1600);}
function stopHeartbeat(){if(demoTimer){clearInterval(demoTimer);demoTimer=null;}}
// Samples stay present while editing, even if live messages have a short lifetime.
fit();seed();startHeartbeat();
window.addEventListener('message',e=>{
 if(e.source!==parent||e.origin!==location.origin)return;
 const m=e.data;
 if(m?.type==='preview-init'){parent.postMessage({type:'preview-ready'},location.origin);return;}
 if(m?.type==='settings'&&m.settings){settings=structuredClone(defaults);for(const g of Object.keys(defaults))if(m.settings[g])Object.assign(settings[g],m.settings[g]);renderer.apply(settings);if(!renderer.items.length)seed();if(!modeIsH())for(const item of renderer.items)item.life=0;fit();startHeartbeat();}
 if(m?.type==='sample'){renderer.add(sample(m.kind));if(!modeIsH())for(const item of renderer.items)item.life=0;}
 if(m?.type==='mediaqueue'){ // seed several distinct videos so the queue + player can be tried
  const ids=['dQw4w9WgXcQ','aqz-KE-bpKQ','9bZkp7q19f0','kJQP7kiw5Fk'],who=['Rahul','Amit','Riya','Karan'];
  ids.forEach((id,i)=>renderer.add({id:'q'+id+Date.now(),authorId:'u'+i,author:who[i],message:'watch this https://youtu.be/'+id}));
  if(!modeIsH())for(const item of renderer.items)item.life=0;
  if(renderer.queue&&renderer.queue.items.length&&renderer.queue.index<0)renderer.queue.playAt(0);}
 if(m?.type==='clear'){renderer.clear();if(renderer.player)renderer.player.close();}
});
window.addEventListener('resize',fit);
window.addEventListener('pagehide',()=>{stopHeartbeat();renderer.destroy();});
parent.postMessage({type:'preview-ready'},location.origin);
