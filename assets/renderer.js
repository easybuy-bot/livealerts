export const RENDERER_VERSION='shine-waapi-v3+horizontal-v2-eventdriven+glassshine-v1+hfix-v1+media-v2-audio';
const NS='http://www.w3.org/2000/svg';
const palette=['#ff7d7d','#ffbf55','#7ad7ff','#8de969','#ff8ad8','#c9a0ff','#ffd75e','#66e6c3'];
export const stableColor=n=>{let h=0;for(const c of String(n))h=(h*31+c.codePointAt(0))>>>0;return palette[h%palette.length];};
const rgba=(hex,opacity)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${opacity})`;
const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
const safeImage=v=>{try{const u=new URL(v);return u.protocol==='https:'&&['yt3.ggpht.com','yt3.googleusercontent.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const mode=s=>((s.layout&&s.layout.mode)==='horizontal'?'horizontal':'vertical');
export class Renderer {
 constructor(root,settings,opts={}){this.root=root;this.items=[];this.seen=new Map();this.duplicates=new Map();this.spam=new Map();this.exiting=new Set();this.lanes=[];this.settings=settings;this.opts=opts;
  // Interactive media layer. It renders above the chat as a separate overlay
  // (never inside a message DOM node). `interactive` gates click-to-open; OBS
  // output stays non-interactive but the same layer is controllable from the editor.
  this.interactive=opts.interactive!==false;
  const getS=()=>this.settings;
  try{
   this.moderation=new MediaModeration(getS);
   this.player=new MediaPlayer(opts.mediaRoot||document.body,getS);
   this.player.onPrev=()=>this.queue&&this.queue.playPrevious();
   this.player.onNext=()=>this.queue&&this.queue.playNext();
   this.queue=new MediaQueue(getS,this.player);
   this.events=new EventEngine(getS);
  }catch(e){/* media subsystem must never break the chat renderer */ this.moderation=this.player=this.queue=this.events=null;}
  this.tick=setInterval(()=>this.expire(),500);this.apply(settings);}
 apply(s){this.settings=structuredClone(s);this.mode=mode(this.settings);
  if(this.mode==='horizontal'){this.applyHorizontal();}
  else{const {general:g,layout:l}=this.settings;
   this.root.classList.remove('h-mode');
   Object.assign(this.root.style,{width:g.width+'px',height:g.height+'px',opacity:g.opacity,transform:`scale(${g.scale})`,transformOrigin:`${l.horizontal} ${l.alignment}`,left:l.horizontal==='left'?'0':'auto',right:l.horizontal==='right'?'0':'auto',top:l.alignment==='top'?'0':'auto',bottom:l.alignment==='bottom'?'0':'auto',gap:l.gap+'px',padding:`${Math.max(l.paddingY,s.canvas.safeArea)}px ${Math.max(l.paddingX,s.canvas.safeArea)}px`,justifyContent:l.alignment==='top'?'flex-start':'flex-end',flexDirection:'column',overflow:'visible',fontFamily:s.typography.font});
  }
  const old=this.items.map(x=>({data:x.data,created:x.created}));this.clear();
  for(const x of old)this.mode==='horizontal'?this.addHorizontal(x.data,x.created,false):this.render(x.data,x.created,false);
  if(this.mode!=='horizontal')while(this.items.length>s.general.maxMessages)this.remove(this.items[0],false);
 }
 // ---- Horizontal (left->right conveyor) layout ----
 applyHorizontal(){const s=this.settings,g=s.general,h=s.horizontal;
  this.root.classList.add('h-mode');
  // Event-driven horizontal row: cards sit in a static flex row. There is NO
  // idle/conveyor movement. A new message inserts at one edge and existing
  // cards shift once (FLIP) to make room, then everything is stationary.
  const align=h.verticalPosition==='top'?'flex-start':h.verticalPosition==='bottom'?'flex-end':'center';
  // Anchor the row to the side the NEWEST card enters from so the newest message
  // is always fully visible (never clipped). LTR: newest on the right -> pin right;
  // RTL: newest on the left -> pin left. Overflow clips the oldest end, which the
  // count-based cap then removes.
  const ltr=(h.direction||'ltr')!=='rtl';
  // Anchor the overlay box to the canvas per layout.alignment / layout.horizontal,
  // exactly like vertical mode, so the OBS output and the editor preview camera
  // (which frame the box by those same settings) agree. Previously this was hard-
  // pinned to top-left, which placed the row off-screen in the preview.
  const l=s.layout;
  Object.assign(this.root.style,{width:g.width+'px',height:g.height+'px',opacity:g.opacity,transform:`scale(${g.scale})`,transformOrigin:`${l.horizontal} ${l.alignment}`,left:l.horizontal==='left'?'0':'auto',right:l.horizontal==='right'?'0':'auto',top:l.alignment==='top'?'0':'auto',bottom:l.alignment==='bottom'?'0':'auto',padding:'0',display:'flex',flexDirection:'row',flexWrap:'nowrap',alignItems:align,justifyContent:ltr?'flex-end':'flex-start',gap:Math.max(0,h.gap||0)+'px',overflow:'hidden',fontFamily:s.typography.font});
  const off=Math.max(0,h.offset||0);
  if(h.verticalPosition==='top'){this.root.style.paddingTop=off+'px';this.root.style.paddingBottom='0';}
  else if(h.verticalPosition==='bottom'){this.root.style.paddingBottom=off+'px';this.root.style.paddingTop='0';}
  else {this.root.style.paddingTop='0';this.root.style.paddingBottom='0';}
  // Drop legacy conveyor state so no residual timers/lanes drive motion.
  this.laneTops=null;this.rowStep=null;this.lanes=[];
 }
 // FLIP helper for the horizontal row: capture survivor x-positions, run a DOM
 // mutation, then animate each survivor from its old position to the new one
 // exactly once. No permanent/looping animation.
 _flipH(mutate){
  const dur=Math.max(80,Math.min(1000,this.settings.horizontal.speed||260));
  const reduced=!!(this.settings.performance&&this.settings.performance.reducedMotion);
  const before=new Map();
  for(const it of this.items){if(it.el&&it.el.isConnected)before.set(it,it.el.getBoundingClientRect().left);}
  mutate();
  if(reduced)return;
  for(const it of this.items){
   if(!before.has(it))continue;const el=it.el;if(!el||!el.isConnected)continue;
   const now=el.getBoundingClientRect().left;const delta=before.get(it)-now;
   if(Math.abs(delta)<0.5)continue;
   el.animate([{transform:`translateX(${delta}px)`},{transform:'translateX(0)'}],{duration:dur,easing:'ease-out'});
  }
 }
 filtered(m){const s=this.settings,f=s.filters,t=String(m.message||''),now=Date.now();
  if((f.hideEmpty&&!t&&!m.superChat&&!m.superSticker)||t.length<f.minLength||t.length>f.maxLength)return true;
  const list=x=>x.split(/[,\n]/).map(v=>v.trim().toLocaleLowerCase()).filter(Boolean);
  if(list(f.blockedWords).some(w=>t.toLocaleLowerCase().includes(w))||list(f.blockedUsernames).includes(String(m.author).toLocaleLowerCase()))return true;
  if(f.hideLinks&&/(https?:\/\/|www\.|\b[a-z\d-]+\.(com|net|org|io|gg|in)\b)/i.test(t))return true;
  const key=String(m.authorId||m.author),duplicate=key+'\0'+t;
  if(f.duplicates&&now-(this.duplicates.get(duplicate)||0)<30000)return true;
  const timestamps=(this.spam.get(key)||[]).filter(v=>now-v<10000);if(timestamps.length>=f.spamLimit)return true;
  timestamps.push(now);this.spam.set(key,timestamps);this.duplicates.set(duplicate,now);
  while(this.duplicates.size>500)this.duplicates.delete(this.duplicates.keys().next().value);while(this.spam.size>500)this.spam.delete(this.spam.keys().next().value);
  return false;
 }
 add(m){if(!m||typeof m!=='object'||this.settings.behavior?.paused)return;
  if(m.id&&this.seen.has(m.id))return;if(this.filtered(m))return;
  if(m.id)this.seen.set(m.id,true);const seenCap=Math.max(this.settings.general.maxMessages,this.settings.performance.queueLimit||100);while(this.seen.size>seenCap)this.seen.delete(this.seen.keys().next().value);
  // Detect media (safe, never fatal) and run the event/rule engine.
  try{m.__media=MediaDetector.detect(String(m.message||''),this.settings);}catch{m.__media=null;}
  let fx=null;try{fx=this.events?this.events.process(m):null;}catch{fx=null;}
  if(this.mode==='horizontal')this.addHorizontal(m,Date.now(),true);
  else {this.render(m,Date.now(),true);while(this.items.length>this.settings.general.maxMessages)this.remove(this.items[0],true);}
  if(m.__media)this.handleMedia(m,fx);
 }
 // Route a detected media submission through moderation + queue, and optionally auto-open.
 handleMedia(m,fx){if(!this.queue||!this.moderation)return;const s=this.settings;if(!s.media||s.media.enabled===false)return;
  const mod=this.moderation.check(m.__media);if(!mod.ok)return; // blocked -> stays as text only
  const r=this.queue.enqueue(m.__media,m,mod.state);
  // Auto-open is automated (not a viewer click), so it works in OBS output too
  // when the streamer opts in via eventRules.autoOpenMedia + queue auto-next.
  if(r.ok&&fx&&fx.autoOpen&&(s.mediaPlayer&&s.mediaPlayer.enabled!==false)&&mod.state==='approved'&&this.queue.index<0)this.queue.playAt(this.queue.items.length-1);
 }
 // Open a media item on demand (card click / editor control). Honors moderation.
 openMedia(media,m){if(!this.player||!media)return;const s=this.settings;if(s.mediaPlayer&&s.mediaPlayer.enabled===false)return;
  if(this.moderation){const mod=this.moderation.check(media);if(!mod.ok)return;}
  this.player.open(media);}
 // Build the message card (DOM + styling) shared by both layouts. Returns an item.
 buildCard(m,created){const s=this.settings,el=node('div','msg');const body=node('div','body'),meta=node('div','meta');el.append(body);body.append(meta);
  const media=(m&&m.__media)||null;let nameEl=null;
  const theme=(typeof MemberTheme!=='undefined')?MemberTheme.resolve(m,s):null;
  const corners=[s.border.radiusTopLeft,s.border.radiusTopRight,s.border.radiusBottomRight,s.border.radiusBottomLeft];
  Object.assign(el.style,{padding:`${s.messageCard.paddingY}px ${s.messageCard.paddingX}px`,gap:s.avatar.spacing+'px',borderRadius:corners.map(n=>n+'px').join(' '),border:s.messageCard.enabled&&s.border.enabled?`${s.border.width}px ${s.border.style} ${rgba(s.border.color,s.border.opacity)}`:'0 solid transparent',boxShadow:s.glow.shadowEnabled?`${s.glow.shadowX}px ${s.glow.shadowY}px ${s.glow.shadowBlur}px ${rgba(s.glow.shadowColor,s.glow.shadowOpacity)}`:'none'});
  if(s.messageCard.enabled){const b=s.background;el.style.background=b.type==='transparent'?'transparent':b.type==='gradient'?`linear-gradient(130deg,${rgba(b.color,b.opacity)},${rgba(b.secondColor,b.opacity)})`:rgba(b.color,b.opacity);if(b.type==='glass')el.style.backdropFilter=`blur(${b.blur}px)`;}
  if(s.avatar.show){const pic=safeImage(m.avatar),av=pic?node('img','avatar'):node('div','avatar');if(pic){av.src=pic;av.alt='';av.referrerPolicy='no-referrer';av.onerror=()=>av.removeAttribute('src');}Object.assign(av.style,{width:s.avatar.size+'px',height:s.avatar.size+'px',borderRadius:s.avatar.shape==='circle'?'50%':s.avatar.shape==='rounded'?'8px':'0',border:`${s.avatar.borderWidth}px solid ${s.avatar.borderColor}`,opacity:s.avatar.opacity});s.avatar.position==='left'?el.prepend(av):el.append(av);}
  meta.style.gap=s.badges.spacing+'px';if(s.username.show){const name=nameEl=node('span','name',String(m.author||'Viewer').slice(0,100));Object.assign(name.style,{color:s.username.colorMode==='fixed'?s.username.color:stableColor(m.authorId||m.author),fontSize:s.username.size+'px',fontWeight:s.username.weight,maxWidth:s.username.maxWidth+'px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:s.username.overflow==='ellipsis'?'nowrap':'normal'});meta.append(name);}
  const tag=(text,cls)=>{const b=node('span','tag '+cls,text);b.style.fontSize=s.badges.size+'px';meta.append(b);};
  if(s.badges.show){if(m.owner&&s.badges.owner)tag('OWNER','owner');if(m.moderator&&s.badges.moderator)tag('MOD','mod');if(m.member&&s.badges.member)tag(s.membership.label,'member');}
  const paid=m.superChat&&s.superChat.enabled&&Number(m.superChat.amountMicros||0)/1e6>=s.superChat.minimumAmount;
  const sticker=m.superSticker&&s.superSticker.enabled;
  if(paid||sticker){const style=paid?s.superChat:s.superSticker;el.style.borderColor=style.borderColor;if(paid)el.style.background=rgba(style.background,style.backgroundOpacity);if(sticker)el.style.background=rgba(style.background,.15);
   if(paid||s.superSticker.showAmount){const amount=node('span','sc-amt',(paid?m.superChat:m.superSticker).amount||'');amount.style.color=paid?s.superChat.amountColor:s.superSticker.borderColor;amount.style.fontSize=(paid?s.superChat.amountSize:12)+'px';meta.append(amount);}
  }else if(m.member&&s.membership.enabled&&s.membership.highlight)el.style.borderColor=s.membership.borderColor;
  if(s.timestamp.show){let date=new Date(m.timestamp||created);if(!Number.isFinite(date.getTime()))date=new Date(created);const time=node('span','time',date.toLocaleTimeString(s.advanced.locale==='auto'?undefined:s.advanced.locale,{hour:'2-digit',minute:'2-digit',hour12:s.timestamp.format==='12',...(s.timestamp.timezone==='UTC'?{timeZone:'UTC'}:{})}));Object.assign(time.style,{color:s.timestamp.color,fontSize:s.timestamp.size+'px',opacity:s.timestamp.opacity});meta.append(time);}
  // Media-aware message text: optionally strip the detected URL or hide text.
  const mc=s.media||{};
  const mediaShown=!!(media&&mc.enabled!==false&&!(this.mode==='horizontal'&&(mc.horizontalMediaMode||'compact')==='disabled'));
  let rawText=String(m.message||m.superSticker?.altText||'');
  if(mediaShown&&media.originalUrl&&mc.showOriginalUrl===false)rawText=rawText.split(media.originalUrl).join('').replace(/\s{2,}/g,' ').trim();
  const hideText=mediaShown&&(mc.showMediaOnly===true||mc.showMessageText===false);
  const txt=node('div','text',rawText.slice(0,s.message.maxLength));Object.assign(txt.style,{color:m.member&&s.membership.enabled&&s.membership.highlight?s.membership.textColor:s.message.color,fontSize:s.typography.size+'px',fontWeight:s.typography.weight,lineHeight:s.typography.lineHeight,letterSpacing:s.typography.letterSpacing+'px',textAlign:s.typography.textAlign,textShadow:s.typography.textShadow?'0 1px 2px rgba(0,0,0,.85)':'none',overflowWrap:s.message.wrap?'anywhere':'normal',whiteSpace:s.message.wrap?'normal':'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
  if(!hideText&&(rawText||!mediaShown))body.append(txt);
  // Media card (compact preview with play button) rendered below the text.
  if(mediaShown){const card=this.buildMediaCard(media,m);if(card)body.append(card);}
  const life=paid?s.superChat.highlightDuration:sticker?s.superSticker.highlightDuration:s.behavior.lifetime;
  let shineColor=paid&&s.superChat.specialShine?s.superChat.borderColor:s.shine.color,shineOn=undefined,entranceAnim=null;
  if(theme){const ap=this.applyRoleTheme(el,{nameEl,txtEl:txt,meta},theme,s);if(ap){if(ap.shineColor)shineColor=ap.shineColor;if(ap.shineOff)shineOn=false;if(ap.entrance)entranceAnim=ap.entrance;}}
  const special=!!(paid||sticker||(theme&&theme.role));
  return {el,data:m,created,life,observer:null,corners,shineColor,paid,sticker,special,role:theme?theme.role:null,shineOn,entranceAnim,media};
 }
 attachShine(item){const s=this.settings;if(item.shineOn===false||!s.shine.enabled)return;const el=item.el,corners=item.corners,col=item.shineColor;
  item.observer=new ResizeObserver(()=>this.ring(el,corners,col));item.observer.observe(el);requestAnimationFrame(()=>this.ring(el,corners,col));}
 // Diagonal specular light-sweep layer for the "Premium Shine Glass" look. This
 // is a SEPARATE effect from the border ring-shine above. Modes:
 //   off | entrance | continuous | periodic | special-only
 // The sweep is a translucent band clipped to the card and driven with WAAPI.
 // It is decorative: it never moves chat cards and is skipped under reduced motion.
 attachSweep(item){const g=this.settings.glassShine;if(!g||g.mode==='off'||this.motionReduced())return;
  const special=!!item.special;const mode=g.mode;
  if(mode==='special-only'&&!special)return;
  const el=item.el;if(!el)return;
  const wrap=node('div','glass-sweep'),band=node('div','gs-band');wrap.append(band);el.append(wrap);
  const ang=Math.max(0,Math.min(90,g.angle??18));
  band.style.width=Math.max(4,Math.min(60,g.width??16))+'%';
  band.style.setProperty('--gs-col',rgba(g.color,g.opacity??0.28));
  const rot=`rotate(${ang}deg)`;const dur=Math.max(200,Math.min(4000,g.duration??1100));
  const single=[{transform:`translateX(-260%) ${rot}`},{transform:`translateX(360%) ${rot}`}];
  const runOnce=()=>{try{band.animate(single,{duration:dur,easing:'ease-in-out'});}catch{}};
  if(mode==='entrance'){runOnce();return;}
  // special-only: a stronger cadence on special cards only (already gated above).
  const period=(mode==='continuous')?Math.max(dur+250,Math.round(dur*1.35)):Math.max((g.period??6)*1000,dur+400);
  // Boost special cards when requested: shorter period so VIP/owner/super chat shine more.
  const eff=(g.specialOnlyRoles!==false&&special&&mode!=='special-only')?Math.max(dur+250,Math.round(period*0.6)):period;
  const frac=Math.min(0.94,dur/eff);
  const loop=[{transform:`translateX(-260%) ${rot}`,offset:0},{transform:`translateX(360%) ${rot}`,offset:frac},{transform:`translateX(360%) ${rot}`,offset:1}];
  try{item.__sweep=band.animate(loop,{duration:eff,iterations:Infinity,easing:'ease-in-out'});}catch{}}
 // Build a compact media preview card. Never uses innerHTML; the click handler
 // opens the video player only where pointer interaction is available.
 buildMediaCard(media,m){const s=this.settings,mc=s.media||{};if(mc.enabled===false)return null;
  const compact=this.mode==='horizontal'&&(mc.horizontalMediaMode||'compact')==='compact';
  const card=node('div','media-card');card.dataset.provider=media.provider;
  const w=compact?Math.min(180,mc.cardWidth||260):(mc.cardWidth||260);
  const th=compact?Math.round((w)*9/16):(mc.cardHeight||150);
  Object.assign(card.style,{width:w+'px',borderRadius:(mc.borderRadius??12)+'px',border:(mc.borderWidth||0)>0?`${mc.borderWidth}px solid ${mc.borderColor||'#6c5ce7'}`:'0',
   background:rgba(mc.background||'#14101f',mc.backgroundOpacity??0.85),boxShadow:mc.shadowEnabled?`0 6px ${mc.shadowBlur||18}px rgba(0,0,0,.45)`:'none',overflow:'hidden',cursor:this.interactive?'pointer':'default'});
  const thumbWrap=node('div','mc-thumb');thumbWrap.style.height=th+'px';
  if(mc.showThumbnail!==false){const src=safeThumb(media.thumbnail||media.src);if(src){const img=node('img','mc-img');img.alt='';img.referrerPolicy='no-referrer';img.loading='lazy';img.onerror=()=>{img.remove();thumbWrap.classList.add('mc-generic');};img.src=src;thumbWrap.append(img);}else thumbWrap.classList.add('mc-generic');}
  else thumbWrap.classList.add('mc-generic');
  if(media.type!=='image'&&mc.showPlayButton!==false){const play=node('div','mc-play');play.append(node('span','mc-tri','▶'));thumbWrap.append(play);}
  card.append(thumbWrap);
  const foot=node('div','mc-foot');
  if(mc.showProvider!==false){const p=node('span','mc-prov',({youtube:'YouTube',vimeo:'Vimeo',file:media.type==='image'?'Image':media.type==='gif'?'GIF':'Video'}[media.provider]||'Media'));foot.append(p);}
  if(mc.showSubmitter!==false&&m&&m.author){foot.append(node('span','mc-by','by '+String(m.author).slice(0,40)));}
  if(foot.childNodes.length)card.append(foot);
  const anim=mc.animation||'fade';
  if(anim!=='none'&&!this.motionReduced()){const f={fade:[{opacity:0},{opacity:1}],scale:[{opacity:0,transform:'scale(.92)'},{opacity:1,transform:'none'}],pop:[{opacity:0,transform:'scale(.85)'},{opacity:1,transform:'none'}]}[anim]||[{opacity:0},{opacity:1}];try{card.animate(f,{duration:220,easing:'ease-out'});}catch{}}
  if(this.interactive){const open=e=>{e.preventDefault();e.stopPropagation();this.openMedia(media,m);};
   card.addEventListener('click',open);card.setAttribute('role','button');card.tabIndex=0;
   card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){open(e);}});}
  return card;}
 // Apply a role/member theme to a built card. Returns hints for shine/entrance.
 applyRoleTheme(el,refs,theme,s){if(!theme||!theme.t)return null;const t=theme.t;const out={};
  const bt=t.backgroundType||'inherit';
  if(bt!=='inherit'){
   if(bt==='transparent')el.style.background='transparent';
   else if(bt==='gradient')el.style.background=`linear-gradient(130deg,${rgba(t.background,t.backgroundOpacity)},${rgba(t.gradientColor,t.backgroundOpacity)})`;
   else if(bt==='glass'){el.style.background=rgba(t.background,Math.min(t.backgroundOpacity,0.6));el.style.backdropFilter='blur(8px)';}
   else if(bt==='image'){const iu=safeBgImage(t.backgroundImage);el.style.background=rgba(t.background,t.backgroundOpacity);if(iu){el.style.backgroundImage=`linear-gradient(rgba(0,0,0,${1-(t.backgroundImageOpacity??0.5)}),rgba(0,0,0,${1-(t.backgroundImageOpacity??0.5)})),url("${iu}")`;el.style.backgroundSize=t.backgroundImageSize||'cover';el.style.backgroundPosition=t.backgroundImagePosition||'center';el.style.backgroundRepeat='no-repeat';}}
   else el.style.background=rgba(t.background,t.backgroundOpacity);
  }
  if((t.borderWidth||0)>0)el.style.border=`${t.borderWidth}px solid ${t.borderColor}`;
  else el.style.borderColor=t.borderColor;
  if(t.glow&&!(s.performance&&s.performance.disableGlow))el.style.boxShadow=`0 0 ${t.glowBlur||18}px ${rgba(t.glowColor,0.9)}`;
  if(refs.txtEl)refs.txtEl.style.color=t.textColor;
  if(refs.nameEl)refs.nameEl.style.color=t.usernameColor;
  if(t.badgeText&&refs.meta){const b=node('span','tag role-badge',String(t.badgeText).slice(0,20));b.style.fontSize=s.badges.size+'px';b.style.background=t.badgeBackground;b.style.color=t.badgeColor;refs.meta.prepend(b);}
  out.shineOff=(t.shine===false);out.shineColor=t.shineColor;
  if(t.animation&&t.animation!=='inherit')out.entrance=t.animation;
  return out;}
 animName(a){if(!a||a==='off'||a==='none')return '';const map={slide:'obs-slide-up',glow:'obs-glow',pulse:'obs-pulse',shine:'obs-fade'};return map[a]||('obs-'+a);}
 render(m,created,animate){const s=this.settings,item=this.buildCard(m,created),el=item.el;
  const ent=item.entranceAnim||s.animation.entrance,entName=this.animName(ent);
  if(animate&&entName&&!s.performance.reducedMotion)el.style.animation=`${entName} ${s.animation.duration}ms ${s.animation.easing} ${s.animation.delay}ms both`;
  s.behavior.newestAtTop?this.root.prepend(el):this.root.append(el);
  this.items.push(item);this.attachShine(item);this.attachSweep(item);
 }
 // Horizontal placement: absolute card that travels along a lane at constant speed.
 addHorizontal(m,created,animate){const s=this.settings,h=s.horizontal;
  const maxV=Math.max(1,Math.round(h.maxVisible||12));
  const ltr=(h.direction||'ltr')!=='rtl';
  const reduced=!!s.performance.reducedMotion;
  // Count-based overflow (no time-based conveyor). The newest card is inserted at
  // the active edge (LTR: appended -> items[last]; RTL: prepended -> items[0]), so
  // the OLDEST card is at the opposite end. Remove that one, per direction.
  if(this.items.length>=maxV){
   if(animate&&h.overflow==='drop-newest')return;
   const oldest=ltr?this.items[0]:this.items[this.items.length-1];
   if(oldest)this.remove(oldest,animate);
  }
  const item=this.buildCard(m,created),el=item.el;el.classList.add('h-msg');
  const doInsert=()=>{
   if(ltr){this.root.append(el);this.items.push(item);}
   else {this.root.prepend(el);this.items.unshift(item);}
  };
  // Insert + shift existing cards exactly once, then STOP. No idle loop.
  if(animate&&!reduced)this._flipH(doInsert);else doInsert();
  this.attachShine(item);this.attachSweep(item);
  if(animate&&!reduced&&h.entrance!=='none'){
   const dur=Math.max(80,Math.min(1000,h.speed||260));
   const dx=ltr?18:-18;
   if(h.entrance==='scale')el.animate([{opacity:0,transform:'scale(.85)'},{opacity:1,transform:'scale(1)'}],{duration:dur,easing:'ease-out'});
   else el.animate([{opacity:0,transform:`translateX(${dx}px)`},{opacity:1,transform:'translateX(0)'}],{duration:dur,easing:h.easing==='linear'?'linear':'ease-out'});
  }
  // Count-based lifetime: 0 = keep until pushed out by maxVisible. A positive
  // value lets expire() retire the card after N seconds.
  item.life=h.lifetime>0?h.lifetime:0;
 }
  motionReduced(){return !!(this.settings.performance&&this.settings.performance.reducedMotion);}
  ring(el,corners,color){if(!el.isConnected)return;
   const prev=el.querySelector('.ring');if(prev){for(const a of (prev.__anims||[])){try{a.cancel();}catch{}}prev.remove();}
   const s=this.settings,w=el.offsetWidth,h=el.offsetHeight,sw=s.shine.thickness/2;
   if(w<2||h<2)return;const [tl,tr,br,bl]=corners.map(r=>Math.max(0,Math.min(r,Math.min(w,h)/2-sw))),x=sw,y=sw,r=w-sw,b=h-sw;
   const d=`M ${x+tl} ${y} H ${r-tr} Q ${r} ${y} ${r} ${y+tr} V ${b-br} Q ${r} ${b} ${r-br} ${b} H ${x+bl} Q ${x} ${b} ${x} ${b-bl} V ${y+tl} Q ${x} ${y} ${x+tl} ${y} Z`;
   const svg=document.createElementNS(NS,'svg');svg.setAttribute('class','ring');svg.setAttribute('width',w);svg.setAttribute('height',h);svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
   svg.style.cssText='position:absolute;left:0;top:0;right:0;bottom:0;overflow:visible;pointer-events:none;z-index:2;max-width:none';
   el.append(svg);
   const measure=document.createElementNS(NS,'path');measure.setAttribute('d',d);svg.append(measure);const per=measure.getTotalLength();measure.remove();
   if(!(per>0))return;
   const dot=0.01,headWidth=Math.max(.5,s.shine.dotSize),base=-per*s.shine.startPosition/100;
   const count=Math.max(1,Math.round(s.shine.count||1));
   const still=this.motionReduced(),dur=Math.max(500,s.shine.speed*1000);
   const anims=[];svg.__anims=anims;
   // Rebuilding the ring (resize, or re-applied settings) must not restart the loop.
   if(this.shineAnchor==null)this.shineAnchor=document.timeline.currentTime||0;
   const layer=(len,opacity,thick,blur=0,phase=0)=>{
    const pa=document.createElementNS(NS,'path');pa.setAttribute('d',d);
    const from=base+len-dot-phase*per/count;
    // Inline styles so no stylesheet version can hide or freeze the dot.
    pa.style.fill='none';pa.style.stroke=color;pa.style.strokeOpacity=String(Math.min(1,opacity*s.shine.opacity));
    pa.style.strokeWidth=thick+'px';pa.style.strokeLinecap='round';
    pa.style.strokeDasharray=`${len}px ${Math.max(1,per-len)}px`;
    pa.style.strokeDashoffset=from+'px';pa.style.animation='none';
    if(blur)pa.style.filter=`blur(${blur}px)`;
    svg.append(pa);
    // Motion is driven from JS (Web Animations API), not CSS keyframes.
    if(!still){try{const a=pa.animate([{strokeDashoffset:from+'px'},{strokeDashoffset:(from-per)+'px'}],
     {duration:dur,iterations:Infinity,easing:s.shine.easing==='ease-in-out'?'ease-in-out':'linear',direction:s.shine.direction==='clockwise'?'normal':'reverse'});try{a.startTime=this.shineAnchor;}catch{}anims.push(a);}catch{}}
   };
   for(let k=0;k<count;k++){
    if(s.shine.trailLength>0)for(let i=s.shine.layers;i>=1;i--)layer(dot+s.shine.trailLength*i/s.shine.layers,.28*(1-i/(s.shine.layers+1)),s.shine.thickness,0,k);
    if(s.glow.enabled&&!s.performance.disableGlow)layer(dot,s.glow.opacity,headWidth*2,s.glow.blur,k);
    layer(dot,1,headWidth,0,k);
   }
  }
 remove(item,animate){const index=this.items.indexOf(item);if(index>=0)this.items.splice(index,1);item.observer?.disconnect();if(item.travel){try{item.travel.cancel();}catch{}}if(item.__sweep){try{item.__sweep.cancel();}catch{}}const rg=item.el&&item.el.querySelector('.ring');if(rg)for(const a of (rg.__anims||[])){try{a.cancel();}catch{}}
  const s=this.settings;
  // Horizontal row: take the exiting card out of flow so survivors reflow, then
  // FLIP-shift the survivors once. Motion happens only on this event, never idle.
  if(item.el&&item.el.classList.contains('h-msg')){
   const el=item.el;const reduced=!!s.performance.reducedMotion;
   const noAnim=!animate||s.animation.exit==='off'||reduced||this.exiting.size>=3;
   const before=noAnim?null:new Map();
   if(before)for(const it of this.items){if(it.el&&it.el.isConnected)before.set(it,it.el.getBoundingClientRect().left);}
   if(el.isConnected){const rect=el.getBoundingClientRect(),prect=this.root.getBoundingClientRect();el.style.position='absolute';el.style.margin='0';el.style.left=(rect.left-prect.left+this.root.scrollLeft)+'px';el.style.top=(rect.top-prect.top+this.root.scrollTop)+'px';}
   if(before){const dur=Math.max(80,Math.min(1000,s.horizontal.speed||260));for(const it of this.items){if(!before.has(it))continue;const e2=it.el;if(!e2||!e2.isConnected)continue;const now=e2.getBoundingClientRect().left;const delta=before.get(it)-now;if(Math.abs(delta)<0.5)continue;e2.animate([{transform:`translateX(${delta}px)`},{transform:'translateX(0)'}],{duration:dur,easing:'ease-out'});}}
   if(noAnim){el.remove();return;}
   const kh=s.animation.exit;const fh=kh==='shrink'?[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.85)'}]:kh==='slide'?[{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-20px)'}]:kh==='blur'?[{opacity:1,filter:'blur(0)'},{opacity:0,filter:'blur(5px)'}]:[{opacity:1},{opacity:0}];
   this.exiting.add(el);const ah=el.animate(fh,{duration:s.animation.duration,easing:s.animation.easing});ah.finished.catch(()=>{}).finally(()=>{el.remove();this.exiting.delete(el);});
   return;
  }
  if(!animate||s.animation.exit==='off'||s.performance.reducedMotion||s.behavior.overflow==='remove'||this.exiting.size>=3){item.el.remove();return;}
  const kind=s.animation.exit;const frames=kind==='shrink'||s.behavior.overflow==='shrink'?[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.8)'}]:kind==='slide'?[{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-20px)'}]:kind==='blur'?[{opacity:1,filter:'blur(0)'},{opacity:0,filter:'blur(5px)'}]:[{opacity:1},{opacity:0}];
  this.exiting.add(item.el);const anim=item.el.animate(frames,{duration:s.animation.duration,easing:s.animation.easing});anim.finished.catch(()=>{}).finally(()=>{item.el.remove();this.exiting.delete(item.el);});
 }
 expire(){const now=Date.now();for(const item of [...this.items])if(item.life>0&&now-item.created>=item.life*1000)this.remove(item,true);}
 event(e){if(e.type==='chat_message')this.add(e.data);if(e.type==='message_deleted')for(const x of [...this.items])if(x.data.id===e.data.id)this.remove(x,false);if(e.type==='user_banned')for(const x of [...this.items])if(x.data.authorId===e.data.authorId)this.remove(x,false);}
 clear(){for(const x of [...this.items])this.remove(x,false);for(const el of this.exiting){el.getAnimations().forEach(a=>a.cancel());el.remove();}this.exiting.clear();}
 destroy(){clearInterval(this.tick);this.clear();this.seen.clear();this.duplicates.clear();this.spam.clear();if(this.player)try{this.player.destroy();}catch{}if(this.queue)this.queue.items=[];}
}
export function sample(kind='Normal') {const m={id:crypto.randomUUID(),authorId:crypto.randomUUID(),author:'Aarav',message:'This little glow looks so clean ✨',timestamp:new Date().toISOString()};
 const changes={Moderator:{author:'Meera',moderator:true,message:'Welcome everyone! Keep the chat friendly.'},Owner:{author:'Varshney Ji',owner:true,message:'We are live! नमस्ते दोस्तों 🙌'},Member:{author:'Riya',member:true,message:'Happy to be part of this community 💜'},'Super Chat':{author:'Kabir',message:'Love the stream!',superChat:{amount:'₹200',amountMicros:200000000,currency:'INR'}},'Super Sticker':{author:'Anaya',message:'Cheering you on 🎉',superSticker:{amount:'₹99',amountMicros:99000000,currency:'INR',altText:'Celebration sticker'}},'Long Message':{message:'A longer message wraps comfortably inside the transparent card. Your stream stays visible behind every message, and the little dot follows all four rounded corners without splitting.'},Emoji:{message:'🔥 🎮 ✨ 💜 🙌 🚀'},Hindi:{author:'अर्जुन',message:'नमस्ते दोस्तों! आज की लाइव स्ट्रीम बहुत अच्छी है 💜'},'Spam Test':{author:'Spam test',authorId:'spam-test',message:'https://example.com repeated test message'},
 'YouTube':{author:'Viewer',message:'Check this out 😂 https://youtu.be/dQw4w9WgXcQ'},
 'YouTube Shorts':{author:'Kylo',message:'lol https://www.youtube.com/shorts/aqz-KE-bpKQ'},
 'Prime':{author:'Nisha',prime:true,message:'Loving the Prime perks 🔵'},
 'VIP':{author:'Rahul',vip:true,message:'This stream is amazing! ✨'},
 'Image':{author:'Sana',message:'nice thumbnail https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'}};
 return {...m,...changes[kind]};
}

/* =====================================================================
   MEDIA / THEME / EVENT SUBSYSTEM  (added in interactive-media-v1)
   All classes below are self-contained and imported implicitly with the
   renderer module, so a single ?v= cache-buster covers everything.
   Every value that touches the DOM is treated as untrusted: URLs are
   parsed with the URL API, only https + known providers are accepted,
   and text is written with textContent (never innerHTML).
   ===================================================================== */
const IMG_EXT=/\.(png|jpe?g|webp|avif|bmp)(?:$|\?)/i, GIF_EXT=/\.(gif)(?:$|\?)/i, VID_EXT=/\.(mp4|webm|ogg|ogv|mov)(?:$|\?)/i;
const THUMB_HOSTS=['i.ytimg.com','img.youtube.com','i.vimeocdn.com'];
export const safeUrl=v=>{try{const u=new URL(String(v));return (u.protocol==='https:'&&!u.username&&!u.password)?u:null;}catch{return null;}};
export const safeThumb=v=>{const u=safeUrl(v);if(!u)return '';if(THUMB_HOSTS.includes(u.hostname))return u.href;if(IMG_EXT.test(u.pathname)||GIF_EXT.test(u.pathname))return u.href;return '';};
// App root derived from this module's own URL (…/assets/renderer.js -> app root).
// Lets bundled asset paths resolve correctly regardless of the document base
// (OBS page at root, editor preview under /assets/, or a production subpath).
const APP_ROOT=(()=>{try{return new URL('../',import.meta.url).href;}catch{return (typeof location!=='undefined'?location.origin+'/':'/');}})();
// Background image resolver for role/preset cards. Accepts remote https images
// (same rules as safeThumb) AND our own bundled, same-origin assets under
// assets/img/ so template presets can ship cosmic card backgrounds portably.
export const safeBgImage=v=>{const s=String(v||'');if(/^assets\/img\/[\w.-]+\.(png|jpe?g|webp|gif|avif)$/i.test(s)){try{return new URL(s,APP_ROOT).href;}catch{return s;}}return safeThumb(s);};
const clampInt=(n,lo,hi,d)=>{n=Number(n);return Number.isFinite(n)?Math.min(hi,Math.max(lo,Math.round(n))):d;};
const fmtTime=s=>{s=Math.max(0,Math.floor(s||0));const m=Math.floor(s/60),ss=String(s%60).padStart(2,'0');return `${m}:${ss}`;};

export class MediaDetector{
 static extractUrls(text){const out=[],re=/https?:\/\/[^\s<>"']+/gi;let m;while((m=re.exec(String(text||'')))){out.push(m[0].replace(/[),.;!?]+$/,''));}return out;}
 static youTubeId(u){const host=u.hostname.replace(/^(www\.|m\.|music\.)/,'');const ok=/^[A-Za-z0-9_-]{11}$/;
  if(host==='youtu.be'){const id=u.pathname.slice(1).split('/')[0];return ok.test(id)?id:null;}
  if(host==='youtube.com'||host==='youtube-nocookie.com'){
   if(u.pathname==='/watch'){const id=u.searchParams.get('v');return id&&ok.test(id)?id:null;}
   const p=u.pathname.split('/').filter(Boolean);
   if(['shorts','embed','live','v'].includes(p[0])&&ok.test(p[1]||''))return p[1];}
  return null;}
 static vimeoId(u){const host=u.hostname.replace(/^www\./,'');
  if(host==='vimeo.com'){const id=u.pathname.split('/').filter(Boolean).find(s=>/^\d+$/.test(s));return id||null;}
  if(host==='player.vimeo.com'){const p=u.pathname.split('/').filter(Boolean);const i=p.indexOf('video');if(i>=0&&/^\d+$/.test(p[i+1]||''))return p[i+1];}
  return null;}
 static classify(raw){const u=safeUrl(raw);if(!u)return null;
  const yt=MediaDetector.youTubeId(u);if(yt)return {type:'video',provider:'youtube',videoId:yt,originalUrl:raw,thumbnail:`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`};
  const vm=MediaDetector.vimeoId(u);if(vm)return {type:'video',provider:'vimeo',videoId:vm,originalUrl:raw,thumbnail:''};
  if(VID_EXT.test(u.pathname))return {type:'video',provider:'file',videoId:null,originalUrl:raw,src:u.href,thumbnail:''};
  if(GIF_EXT.test(u.pathname))return {type:'gif',provider:'file',videoId:null,originalUrl:raw,src:u.href,thumbnail:u.href};
  if(IMG_EXT.test(u.pathname))return {type:'image',provider:'file',videoId:null,originalUrl:raw,src:u.href,thumbnail:u.href};
  return null;}
 static allowed(media,s){const m=s.media||{};
  if(media.provider==='youtube')return m.allowYouTube!==false;
  if(media.provider==='vimeo')return m.allowVimeo!==false;
  if(media.type==='video')return m.allowDirectVideo!==false;
  if(media.type==='image')return m.allowImages!==false;
  if(media.type==='gif')return m.allowGIF!==false;
  return false;}
 static detect(text,s){if(!s||!s.media||s.media.enabled===false)return null;
  for(const raw of MediaDetector.extractUrls(text)){const c=MediaDetector.classify(raw);if(c&&MediaDetector.allowed(c,s))return c;}return null;}
}
const embedUrl=(media,opts={})=>{
 const ap=opts.autoplay===false?0:1, mu=opts.muted?1:0;
 if(media.provider==='youtube')return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(media.videoId)}?autoplay=${ap}&mute=${mu}&rel=0&modestbranding=1&playsinline=1`;
 if(media.provider==='vimeo')return `https://player.vimeo.com/video/${encodeURIComponent(media.videoId)}?autoplay=${ap}&muted=${mu}`;
 return '';};

/* ---- Role / member theming ------------------------------------------ */
const ROLE_KEYS={owner:'role_owner',moderator:'role_moderator',member:'role_member',prime:'role_prime',vip:'role_vip',superchat:'role_superchat'};
export function roleOf(m){if(!m)return null;if(m.superChat)return 'superchat';if(m.owner)return 'owner';if(m.moderator)return 'moderator';
 const t=String(m.tier||m.role||'').toLowerCase();if(t==='vip'||m.vip)return 'vip';if(t==='prime'||m.prime)return 'prime';if(m.member)return 'member';return null;}
export const MemberTheme={
 resolve(m,s){if(!s||!s.roleThemes||!s.roleThemes.enabled)return null;
  if(s.eventRules&&s.eventRules.enabled!==false&&s.eventRules.memberAutoTheme===false)return null;
  const r=roleOf(m);if(!r)return null;const g=s[ROLE_KEYS[r]];if(!g||g.enabled===false)return null;return {role:r,t:g};}
};

/* ---- Media moderation (domain allow/block, approval) ---------------- */
export class MediaModeration{
 constructor(getS){this.getS=getS;}
 hostAllowed(media){const s=this.getS().mediaModeration||{};const u=safeUrl(media.originalUrl);if(!u)return false;
  const host=u.hostname.replace(/^www\./,'');const list=x=>String(x||'').split(/[,\n]/).map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(list(s.blockedDomains).some(d=>host===d||host.endsWith('.'+d)))return false;
  const allow=list(s.allowedDomains);if(allow.length&&!allow.some(d=>host===d||host.endsWith('.'+d)))return false;
  return true;}
 check(media){const s=this.getS().mediaModeration||{};if(s.enabled===false)return {ok:true,state:'approved'};
  if(!this.hostAllowed(media))return {ok:false,state:'blocked',reason:'domain'};
  return {ok:true,state:s.requireApproval?'pending':'approved'};}
}

/* ---- Media queue ---------------------------------------------------- */
export class MediaQueue{
 constructor(getS,player){this.getS=getS;this.player=player;this.items=[];this.index=-1;this.userTimes=new Map();this.userCounts=new Map();this.onChange=null;
  if(player)player.onEnded=()=>{if((this._s()).autoPlayNext!==false)this.playNext();};}
 _s(){return this.getS().mediaQueue||{};}
 canSubmit(media,m){const s=this._s(),now=Date.now(),key=String((m&&(m.authorId||m.author))||'anon');
  if(s.preventDuplicates!==false&&this.items.some(it=>it.provider===media.provider&&(it.videoId?it.videoId===media.videoId:it.originalUrl===media.originalUrl)))return {ok:false,reason:'duplicate'};
  const cd=Math.max(0,s.submissionCooldown||0)*1000,last=this.userTimes.get(key)||0;if(cd&&now-last<cd)return {ok:false,reason:'cooldown'};
  const cap=s.maxSubmissionsPerUser||0;if(cap>0&&(this.userCounts.get(key)||0)>=cap)return {ok:false,reason:'user_limit'};
  if(this.items.length>=Math.max(1,s.maxQueueItems||20))return {ok:false,reason:'queue_full'};
  return {ok:true};}
 enqueue(media,m,state){const s=this._s();if(s.enabled===false)return {ok:false,reason:'disabled'};
  const chk=this.canSubmit(media,m);if(!chk.ok)return chk;
  const key=String((m&&(m.authorId||m.author))||'anon');this.userTimes.set(key,Date.now());this.userCounts.set(key,(this.userCounts.get(key)||0)+1);
  const entry={...media,submittedBy:(m&&m.author)||'',messageId:(m&&m.id)||'',state:state||(s.requireApproval?'pending':'approved')};
  this.items.push(entry);while(this.items.length>Math.max(1,s.maxQueueItems||20)){this.items.shift();if(this.index>=0)this.index--;}
  this._emit();
  if(s.queueMode==='auto-next'&&entry.state==='approved'&&this.index<0)this.playNext();
  return {ok:true,entry};}
 approve(i){if(this.items[i]){this.items[i].state='approved';this._emit();}}
 reject(i){if(this.items[i]){this.items[i].state='rejected';this._emit();}}
 playAt(i){if(i<0||i>=this.items.length)return;this.index=i;const it=this.items[i];it.state='playing';if(this.player)this.player.open(it);this._emit();}
 playNext(){if(this.items[this.index])this.items[this.index].state='played';let i=this.index+1;while(i<this.items.length&&['rejected','pending'].includes(this.items[i].state))i++;
  if(i<this.items.length)this.playAt(i);else{this.index=this.items.length;this._emit();}}
 playPrevious(){const i=this.index-1;if(i>=0)this.playAt(i);}
 skipCurrent(){this.playNext();}
 removeFromQueue(i){if(i>=0&&i<this.items.length){this.items.splice(i,1);if(i<=this.index)this.index--;this._emit();}}
 moveQueueItem(from,to){if(from<0||from>=this.items.length||to<0||to>=this.items.length)return;const [x]=this.items.splice(from,1);this.items.splice(to,0,x);this._emit();}
 clearQueue(){this.items=[];this.index=-1;this.userCounts.clear();this._emit();}
 _emit(){if(this.onChange)try{this.onChange(this.items.slice(),this.index);}catch{}}
}

/* ---- Event / rule engine foundation --------------------------------- */
export class EventEngine{
 constructor(getS){this.getS=getS;this.rules=EventEngine.defaults();}
 static defaults(){return [
  {event:'chat_message',when:m=>!!m.__media,action:'openMedia'},
  {event:'chat_message',when:m=>!!(m.member||m.owner||m.moderator||m.vip||m.prime),action:'applyTheme'},
  {event:'chat_message',when:(m,s)=>m.superChat&&Number(m.superChat.amountMicros||0)/1e6>=((s.eventRules||{}).superChatThreshold||0),action:'highlight'},
 ];}
 addRule(r){this.rules.push(r);}
 process(m){const s=this.getS();const er=s.eventRules||{};const out={openMedia:false,autoOpen:false,highlight:false,applyTheme:false};
  if(er.enabled===false)return out;
  for(const r of this.rules){let ok=false;try{ok=r.when(m,s);}catch{ok=false;}if(!ok)continue;
   if(r.action==='openMedia'){out.openMedia=true;out.autoOpen=!!er.autoOpenMedia;}
   else if(r.action==='highlight'&&er.highlightSuperChat!==false)out.highlight=true;
   else if(r.action==='applyTheme')out.applyTheme=true;}
  return out;}
}

/* ---- YouTube IFrame API loader (free, no Data API key) -------------- */
let __ytApiPromise=null;
function loadYouTubeAPI(){if(window.YT&&window.YT.Player)return Promise.resolve(window.YT);
 if(__ytApiPromise)return __ytApiPromise;
 __ytApiPromise=new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('yt_api_timeout')),9000);
  const prev=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=function(){if(prev)try{prev();}catch{}clearTimeout(to);res(window.YT);};
  const sc=document.createElement('script');sc.src='https://www.youtube.com/iframe_api';sc.async=true;sc.onerror=()=>{clearTimeout(to);rej(new Error('yt_api_load'));};document.head.appendChild(sc);});
 return __ytApiPromise;}

/* ---- The video player modal (separate layer above the chat) --------- */
export class MediaPlayer{
 constructor(mountRoot,getS){this.getS=getS;this.mount=mountRoot||document.body;this.onEnded=null;this.onPrev=null;this.onNext=null;
  this.current=null;this.raf=0;this.yt=null;this.video=null;this.frame=null;this.opened=false;this._autoCloseT=0;this._keyHandler=e=>this._onKey(e);this._build();}
 _s(){return this.getS().mediaPlayer||{};}
 _build(){const layer=document.createElement('div');layer.className='media-layer';layer.dataset.open='0';
  const backdrop=document.createElement('div');backdrop.className='ml-backdrop';
  const modal=document.createElement('div');modal.className='ml-modal';modal.tabIndex=-1;
  const header=document.createElement('div');header.className='ml-header';
  const title=document.createElement('div');title.className='ml-title';
  const closeBtn=document.createElement('button');closeBtn.type='button';closeBtn.className='ml-btn ml-close';closeBtn.textContent='✕';closeBtn.title='Close';
  header.append(title,closeBtn);
  const stage=document.createElement('div');stage.className='ml-stage';
  const note=document.createElement('div');note.className='ml-note';note.style.display='none';
  const controls=document.createElement('div');controls.className='ml-controls';
  const pbar=document.createElement('div');pbar.className='ml-pbar';const pfill=document.createElement('div');pfill.className='ml-pfill';pbar.append(pfill);
  const row=document.createElement('div');row.className='ml-row';
  const mk=(cls,txt,t)=>{const b=document.createElement('button');b.type='button';b.className='ml-btn '+cls;b.textContent=txt;b.title=t||'';return b;};
  const bPrev=mk('ml-prev','⏮','Previous'),bBack=mk('ml-back','⏪','Seek back'),bPlay=mk('ml-play','⏸','Play / Pause'),bFwd=mk('ml-fwd','⏩','Seek forward'),bNext=mk('ml-next','⏭','Next'),bReplay=mk('ml-replay','↻','Replay');
  const time=document.createElement('span');time.className='ml-time';time.textContent='0:00 / 0:00';
  const bMute=mk('ml-mute','🔊','Mute'),vol=document.createElement('input');vol.type='range';vol.min=0;vol.max=100;vol.step=1;vol.className='ml-vol';vol.value=80;
  const bFull=mk('ml-full','⛶','Fullscreen');
  row.append(bPrev,bBack,bPlay,bFwd,bNext,bReplay,time,bMute,vol,bFull);
  controls.append(pbar,row);modal.append(header,stage,note,controls);layer.append(backdrop,modal);this.mount.appendChild(layer);
  Object.assign(this,{layer,backdrop,modal,title,stage,note,controls,pbar,pfill,row,time,vol,bPrev,bBack,bPlay,bFwd,bNext,bReplay,bMute,bFull,closeBtn});
  closeBtn.onclick=()=>this.close();backdrop.onclick=()=>this.close();
  bPlay.onclick=()=>this.togglePlay();bBack.onclick=()=>this.seekRelative(-(this._s().seekStep||10));bFwd.onclick=()=>this.seekRelative(this._s().seekStep||10);
  bReplay.onclick=()=>this.replay();bPrev.onclick=()=>{if(this.onPrev)this.onPrev();};bNext.onclick=()=>{if(this.onNext)this.onNext();};
  bMute.onclick=()=>this.toggleMute();vol.oninput=()=>this.setVolume(Number(vol.value));bFull.onclick=()=>this.toggleFullscreen();
  pbar.onclick=e=>{const r=pbar.getBoundingClientRect();const f=Math.min(1,Math.max(0,(e.clientX-r.left)/Math.max(1,r.width)));const d=this.duration();if(d>0)this.seekTo(f*d);};
 }
 _applyStyle(){const s=this._s(),m=this.modal,l=this.layer;
  l.style.setProperty('--ml-overlay',String(s.overlayOpacity??0.6));
  const pos=s.position||'center';
  m.style.left=m.style.right=m.style.top=m.style.bottom=m.style.transform='';
  if(pos==='custom'){m.style.left=(s.x??50)+'%';m.style.top=(s.y??50)+'%';m.style.transform='translate(-50%,-50%)';}
  else if(pos==='top'){m.style.left='50%';m.style.top='4%';m.style.transform='translateX(-50%)';}
  else if(pos==='bottom'){m.style.left='50%';m.style.bottom='4%';m.style.transform='translateX(-50%)';}
  else {m.style.left='50%';m.style.top='50%';m.style.transform='translate(-50%,-50%)';}
  m.style.width=(s.width||720)+'px';m.style.maxWidth=(s.maxWidth||90)+'vw';m.style.maxHeight=(s.maxHeight||90)+'vh';
  this.stage.style.height=(s.height||405)+'px';this.stage.style.maxHeight='calc('+(s.maxHeight||90)+'vh - 96px)';
  m.style.borderRadius=(s.borderRadius||14)+'px';m.style.border=(s.borderWidth||0)>0?`${s.borderWidth}px solid ${s.borderColor||'#6c5ce7'}`:'0';
  m.style.background=rgba(s.background||'#0b0910',s.backgroundOpacity??1);
  m.style.boxShadow=`0 20px ${s.shadowBlur||40}px rgba(0,0,0,${s.shadowOpacity??0.5})`;
  this.controls.style.display=s.showControls===false?'none':'';
  this.pbar.style.display=s.showProgress===false?'none':'';
  this.vol.style.display=this.bMute.style.display=s.showVolume===false?'none':'';
  this.bBack.style.display=this.bFwd.style.display=s.showSeekButtons===false?'none':'';
  this.bFull.style.display=s.showFullscreen===false?'none':'';
  this.closeBtn.style.display=s.showCloseButton===false?'none':'';
 }
 open(media){if(!media)return;const s=this._s();if(s.enabled===false)return;
  this.destroyPlayer();this.current=media;this._applyStyle();
  this.title.textContent=(media.submittedBy?media.submittedBy+' • ':'')+({youtube:'YouTube',vimeo:'Vimeo',file:'Video'}[media.provider]||'Media');
  this._showNote('');this.layer.dataset.open='1';this.opened=true;
  const dur=Math.max(0,(this._s().animationDuration||260));
  const anim=this._s().animation||'scale';
  if(anim!=='none'&&!this._reduced()){const frames={fade:[{opacity:0},{opacity:1}],scale:[{opacity:0,transform:this.modal.style.transform+' scale(.9)'},{opacity:1,transform:this.modal.style.transform+' scale(1)'}],pop:[{opacity:0,transform:this.modal.style.transform+' scale(.8)'},{opacity:1,transform:this.modal.style.transform}],slide:[{opacity:0,transform:this.modal.style.transform+' translateY(24px)'},{opacity:1,transform:this.modal.style.transform}]}[anim]||[{opacity:0},{opacity:1}];
   try{this.modal.animate(frames,{duration:dur,easing:'ease-out'});}catch{}}
  document.addEventListener('keydown',this._keyHandler,true);
  setTimeout(()=>{try{this.modal.focus({preventScroll:true});}catch{}},0);
  if(media.type==='image'||media.type==='gif')this._createImage(media);
  else if(media.provider==='file')this._createNative(media);
  else if(media.provider==='youtube')this._createYouTube(media);
  else if(media.provider==='vimeo')this._createFrame(media);
  else this._showNote('Unsupported media.');
 }
 _reduced(){const p=this.getS().performance;return !!(p&&p.reducedMotion);}
 _clearStage(){this.stage.textContent='';}
 _createImage(media){this._clearStage();const src=safeThumb(media.src||media.thumbnail);if(!src){this._fallback('Image unavailable.');return;}
  const img=document.createElement('img');img.className='ml-media';img.alt='';img.referrerPolicy='no-referrer';img.onerror=()=>this._fallback('Image failed to load.');img.src=src;this.stage.append(img);
  this._noControls();}
 _audio(){const s=this._s();return {auto:s.autoplay!==false,muted:!!s.startMuted,vol:clampInt(s.defaultVolume,0,100,80)};}
 _createNative(media){this._clearStage();const u=safeUrl(media.src);if(!u){this._fallback('Video unavailable.');return;}
  const a=this._audio();
  const v=document.createElement('video');v.className='ml-media';v.src=u.href;v.autoplay=a.auto;v.controls=false;v.playsInline=true;v.preload='metadata';
  v.muted=a.muted||a.vol===0;v.volume=a.vol/100;this.video=v;this.stage.append(v);
  v.addEventListener('loadedmetadata',()=>{if(this._durationExceeds(v.duration)){this._fallback('Video exceeds the allowed length.');return;}this._syncVol();this._updateProgress();});
  v.addEventListener('ended',()=>this._ended());
  v.addEventListener('error',()=>this._fallback('This video could not be played.'));
  if(a.auto)v.play().catch(()=>{/* autoplay may be blocked; user can press play */this._setPlayIcon(false);});
  else this._setPlayIcon(false);   // autoplay off: wait for a manual play (interaction window)
  this._startTicker();}
 _createFrame(media){this._clearStage();const a=this._audio();const url=embedUrl(media,{autoplay:a.auto,muted:a.muted||a.vol===0});if(!url){this._fallback('Video unavailable.');return;}
  const f=document.createElement('iframe');f.className='ml-media';f.src=url;f.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';f.setAttribute('allowfullscreen','');f.referrerPolicy='strict-origin-when-cross-origin';this.frame=f;this.stage.append(f);
  this._showNote('Basic embed player — seek/volume use the player’s own controls.');
  this._limitedControls();}
 _createYouTube(media){this._clearStage();const holder=document.createElement('div');holder.className='ml-media';this.stage.append(holder);
  const a=this._audio();
  loadYouTubeAPI().then(YT=>{if(this.current!==media)return;
   this.yt=new YT.Player(holder,{width:'100%',height:'100%',videoId:media.videoId,
    playerVars:{autoplay:a.auto?1:0,mute:(a.muted||a.vol===0)?1:0,rel:0,modestbranding:1,playsinline:1,controls:0},
    events:{onReady:e=>{try{e.target.setVolume(a.vol);if(a.muted||a.vol===0)e.target.mute();else e.target.unMute();if(a.auto)e.target.playVideo();}catch{}
      const d=this._durationExceeds(this.yt&&this.yt.getDuration&&this.yt.getDuration());if(d){this._fallback('Video exceeds the allowed length.');return;}
      this._syncVol();this._startTicker();if(!a.auto)this._setPlayIcon(false);},
     onStateChange:e=>{if(e.data===YT.PlayerState.ENDED)this._ended();this._setPlayIcon(e.data===YT.PlayerState.PLAYING);},
     onError:()=>this._fallbackEmbed(media)}});
  }).catch(()=>this._fallbackEmbed(media));
 }
 _fallbackEmbed(media){/* IFrame API blocked/unavailable -> plain embed still plays */
  this.yt=null;this._createFrame(media);this._showNote('Using basic embed player (advanced controls unavailable).');}
 _durationExceeds(d){const max=Number((this.getS().mediaModeration||{}).maxVideoDuration||0);return max>0&&Number(d)>0&&Number(d)>max;}
 _fallback(msg){this._clearStage();this._showNote(msg||'Media unavailable.');this._noControls();this._stopTicker();}
 _showNote(t){this.note.textContent=t||'';this.note.style.display=t?'':'none';}
 _noControls(){this.pbar.style.display='none';[this.bPlay,this.bBack,this.bFwd,this.bReplay,this.time,this.vol,this.bMute].forEach(el=>el.style.display='none');}
 _limitedControls(){this.pbar.style.display='none';[this.bBack,this.bFwd,this.bReplay,this.time].forEach(el=>el.style.display='none');}
 duration(){try{if(this.video)return this.video.duration||0;if(this.yt&&this.yt.getDuration)return this.yt.getDuration()||0;}catch{}return 0;}
 currentTime(){try{if(this.video)return this.video.currentTime||0;if(this.yt&&this.yt.getCurrentTime)return this.yt.getCurrentTime()||0;}catch{}return 0;}
 isPaused(){try{if(this.video)return this.video.paused;if(this.yt&&this.yt.getPlayerState)return this.yt.getPlayerState()!==1;}catch{}return true;}
 play(){try{if(this.video)this.video.play().catch(()=>{});else if(this.yt&&this.yt.playVideo)this.yt.playVideo();}catch{}this._setPlayIcon(true);}
 pause(){try{if(this.video)this.video.pause();else if(this.yt&&this.yt.pauseVideo)this.yt.pauseVideo();}catch{}this._setPlayIcon(false);}
 togglePlay(){this.isPaused()?this.play():this.pause();}
 seekTo(t){try{if(this.video)this.video.currentTime=Math.max(0,t);else if(this.yt&&this.yt.seekTo)this.yt.seekTo(Math.max(0,t),true);}catch{}this._updateProgress();}
 seekRelative(d){this.seekTo(this.currentTime()+d);}
 setVolume(v){v=clampInt(v,0,100,80);try{if(this.video){this.video.volume=v/100;this.video.muted=v===0;}else if(this.yt&&this.yt.setVolume){this.yt.setVolume(v);if(v===0)this.yt.mute&&this.yt.mute();else this.yt.unMute&&this.yt.unMute();}}catch{}this.vol.value=v;this.bMute.textContent=(v===0||this.isMuted())?'🔈':'🔊';}
 _mute(on){try{if(this.video)this.video.muted=!!on;else if(this.yt){if(on)this.yt.mute&&this.yt.mute();else this.yt.unMute&&this.yt.unMute();}}catch{}this.bMute.textContent=(on||Number(this.vol.value)===0)?'🔈':'🔊';}
 isMuted(){try{if(this.video)return!!this.video.muted;if(this.yt&&this.yt.isMuted)return!!this.yt.isMuted();}catch{}return false;}
 // Apply the customised volume + start-muted preference (keeps the slider value so unmute restores it).
 _syncVol(){const a=this._audio();this.setVolume(a.vol);this._mute(a.muted||a.vol===0);}
 toggleMute(){this._mute(!this.isMuted());}
 replay(){this.seekTo(0);this.play();}
 toggleFullscreen(){const el=this.modal;try{if(document.fullscreenElement)document.exitFullscreen();else if(el.requestFullscreen)el.requestFullscreen();}catch{}}
 _setPlayIcon(playing){this.bPlay.textContent=playing?'⏸':'▶';}
 _updateProgress(){const d=this.duration(),c=this.currentTime();this.pfill.style.width=(d>0?Math.min(100,c/d*100):0)+'%';this.time.textContent=fmtTime(c)+' / '+fmtTime(d);this._setPlayIcon(!this.isPaused());}
 _startTicker(){this._stopTicker();const loop=()=>{if(!this.opened)return;this._updateProgress();this.raf=requestAnimationFrame(loop);};this.raf=requestAnimationFrame(loop);}
 _stopTicker(){if(this.raf){cancelAnimationFrame(this.raf);this.raf=0;}}
 _ended(){this._setPlayIcon(false);const s=this._s();if(s.autoClose)this._autoCloseT=setTimeout(()=>this.close(),Math.max(0,(s.autoCloseSeconds||5)*1000));if(this.onEnded)try{this.onEnded();}catch{}}
 _onKey(e){if(!this.opened)return;const k=e.key;
  if(k==='Escape'){this.close();e.preventDefault();return;}
  if(k===' '||k==='k'){this.togglePlay();e.preventDefault();}
  else if(k==='ArrowLeft'){this.seekRelative(-(this._s().seekStep||10));e.preventDefault();}
  else if(k==='ArrowRight'){this.seekRelative(this._s().seekStep||10);e.preventDefault();}
  else if(k==='m'||k==='M'){this.toggleMute();e.preventDefault();}
  else if(k==='f'||k==='F'){this.toggleFullscreen();e.preventDefault();}}
 destroyPlayer(){this._stopTicker();if(this._autoCloseT){clearTimeout(this._autoCloseT);this._autoCloseT=0;}
  if(this.yt){try{this.yt.destroy();}catch{}this.yt=null;}
  if(this.video){try{this.video.pause();this.video.removeAttribute('src');this.video.load();}catch{}this.video=null;}
  this.frame=null;this._clearStage();}
 close(){if(!this.opened)return;this.opened=false;this.layer.dataset.open='0';document.removeEventListener('keydown',this._keyHandler,true);this.destroyPlayer();this.current=null;this._showNote('');}
 destroy(){this.close();try{this.layer.remove();}catch{}}
}
