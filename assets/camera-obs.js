/* Live Camera Studio — OBS output / viewer renderer.
 *
 * The page is loaded once with a fixed URL (/obs.php?t=TOKEN). It polls
 * camera-status.php and re-composites the active scene IN PLACE whenever the
 * `version` changes, so switching scenes never requires changing the OBS URL
 * or reloading the Browser Source.
 *
 * Camera elements attempt WebRTC (WHEP) playback against the media server.
 * When the media server is unreachable (e.g. before it is deployed) each feed
 * shows a labelled placeholder with the live device status instead of failing.
 */
(function () {
  'use strict';

  var LAYOUT_GRID = {
    single: [{ x: 0, y: 0, w: 100, h: 100 }],
    pip:    [{ x: 0, y: 0, w: 100, h: 100 }, { x: 68, y: 66, w: 30, h: 30 }],
    side:   [{ x: 0, y: 0, w: 50, h: 100 }, { x: 50, y: 0, w: 50, h: 100 }],
    grid:   [{ x: 0, y: 0, w: 50, h: 50 }, { x: 50, y: 0, w: 50, h: 50 },
             { x: 0, y: 50, w: 50, h: 50 }, { x: 50, y: 50, w: 50, h: 50 }]
  };

  function clamp(n, lo, hi) { n = parseFloat(n); if (isNaN(n)) n = lo; return Math.max(lo, Math.min(hi, n)); }

  /* Resolve an element's box: explicit coords if given, else the layout slot. */
  function boxFor(el, i, layout) {
    var explicit = (el.w != null && parseFloat(el.w) > 0);
    if (explicit) {
      return { x: clamp(el.x, 0, 100), y: clamp(el.y, 0, 100),
               w: clamp(el.w, 1, 100), h: clamp(el.h, 1, 100) };
    }
    var slots = LAYOUT_GRID[layout] || LAYOUT_GRID.single;
    return slots[i % slots.length];
  }

  function parseProps(p) {
    if (!p) return {};
    if (typeof p === 'object') return p;
    try { return JSON.parse(p) || {}; } catch (e) { return {}; }
  }

  /* Pure compositor: (re)build the stage DOM from a status payload. Exposed for
     tests. Returns the number of elements rendered. */
  function renderScene(stage, status) {
    stage.innerHTML = '';
    if (!status || !status.scene) {
      var none = document.createElement('div');
      none.className = 'cam-offline';
      none.textContent = 'No active scene';
      stage.appendChild(none);
      return 0;
    }
    var layout = status.scene.layout || 'single';
    var els = (status.elements || []).slice().sort(function (a, b) {
      return (a.z_index | 0) - (b.z_index | 0);
    });
    var devices = {};
    (status.devices || []).forEach(function (d) { devices[d.id] = d; });

    var camIndex = 0, rendered = 0;
    els.forEach(function (el) {
      var type = el.element_type || 'camera';
      var box = boxFor(el, type === 'camera' ? camIndex : 0, layout);
      if (type === 'camera') camIndex++;
      var node = document.createElement('div');
      node.className = 'cam-el type-' + type;
      node.style.left = box.x + '%'; node.style.top = box.y + '%';
      node.style.width = box.w + '%'; node.style.height = box.h + '%';
      node.style.zIndex = String(el.z_index | 0);
      node.setAttribute('data-element-id', el.id);
      var props = parseProps(el.props);

      if (type === 'camera') {
        var dev = devices[el.device_id] || {};
        node.setAttribute('data-device-id', el.device_id || '');
        node.setAttribute('data-status', dev.status || 'offline');
        var video = document.createElement('video');
        video.autoplay = true; video.muted = true; video.playsInline = true;
        node.appendChild(video);
        var ph = document.createElement('div');
        ph.className = 'cam-ph';
        ph.innerHTML = '<span class="dot ' + (dev.status || 'offline') + '"></span>' +
          '<span class="cam-name">' + escapeHtml(dev.name || el.label || 'Camera') + '</span>' +
          '<span class="cam-sub">' + escapeHtml(statusLabel(dev.status)) + '</span>';
        node.appendChild(ph);
        // Privacy/blur boxes passed via props.blur = [{x,y,w,h}]
        (props.blur || []).forEach(function (b) {
          var bz = document.createElement('div');
          bz.className = 'cam-blur';
          bz.style.left = clamp(b.x,0,100) + '%'; bz.style.top = clamp(b.y,0,100) + '%';
          bz.style.width = clamp(b.w,1,100) + '%'; bz.style.height = clamp(b.h,1,100) + '%';
          node.appendChild(bz);
        });
        attachFeed(video, ph, dev, status);
      } else if (type === 'text') {
        node.textContent = props.text || el.label || '';
        if (props.color) node.style.color = props.color;
      } else if (type === 'image') {
        if (props.url) node.style.backgroundImage = 'url("' + props.url + '")';
      } else if (type === 'overlay') {
        if (props.url) {
          var f = document.createElement('iframe');
          f.src = props.url; f.style.cssText = 'width:100%;height:100%;border:0;background:transparent';
          f.setAttribute('allowtransparency', 'true');
          node.appendChild(f);
        }
      }
      stage.appendChild(node);
      rendered++;
    });
    return rendered;
  }

  function statusLabel(s) {
    if (s === 'streaming') return 'Live';
    if (s === 'online') return 'Connected, standby';
    if (s === 'error') return 'Signal error';
    return 'Waiting for camera…';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* Try WHEP playback; on any failure keep the placeholder visible. */
  function attachFeed(video, ph, dev, status) {
    if (!status.webrtc || !status.whep_base || !dev.stream_path || dev.status !== 'streaming') return;
    if (typeof RTCPeerConnection === 'undefined' || typeof fetch === 'undefined') return;
    var url = status.whep_base.replace(/\/$/, '') + '/' + dev.stream_path + '/whep';
    whepPlay(video, url).then(function () {
      ph.style.display = 'none';
    }).catch(function () { /* keep placeholder */ });
  }

  /* Minimal WHEP (WebRTC-HTTP Egress) client. */
  function whepPlay(video, url) {
    var pc = new RTCPeerConnection({ iceServers: [] });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = function (e) { if (e.streams && e.streams[0]) video.srcObject = e.streams[0]; };
    return pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer);
    }).then(function () {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp });
    }).then(function (res) {
      if (!res.ok) throw new Error('whep ' + res.status);
      return res.text();
    }).then(function (answer) {
      return pc.setRemoteDescription({ type: 'answer', sdp: answer });
    });
  }

  /* Polling loop with in-place scene switching. */
  function start(cfg) {
    var stage = document.getElementById('cam-stage');
    if (!stage) return;
    var lastVersion = null;
    var timer = null;

    function tick() {
      fetch(cfg.statusUrl, { cache: 'no-store' }).then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.ok) return;
          if (data.enabled === false) {
            if (lastVersion !== 'disabled') { stage.innerHTML = '<div class="cam-offline">Studio disabled</div>'; lastVersion = 'disabled'; }
            return;
          }
          if (data.version !== lastVersion) {
            lastVersion = data.version;
            renderScene(stage, data);
            document.dispatchEvent(new CustomEvent('cam:scene', { detail: data }));
          }
        }).catch(function () { /* transient; retry next tick */ });
    }
    tick();
    timer = setInterval(tick, cfg.interval || 2500);
    window.__cameraStop = function () { if (timer) clearInterval(timer); };
  }

  // Public surface (also used by the test harness).
  window.CameraOBS = { renderScene: renderScene, whepPlay: whepPlay, start: start, LAYOUT_GRID: LAYOUT_GRID };
  window.__cameraRender = renderScene;

  if (window.CAMERA && window.CAMERA.autostart !== false) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(window.CAMERA); });
    else start(window.CAMERA);
  }
})();
