# Interactive media (chat video cards + center player) — v3

This upgrade turns OverlayHub into an interactive media engine on top of the
existing chat overlay. It is **client-side only** (renderer/editor assets) and
**backwards-compatible**: existing overlays, settings, tokens and OBS URLs keep
working. There is **no database change** and `install.php` does **not** need to
be run for this feature.

## What it adds
- **Smart link detection** in chat: YouTube (watch/`youtu.be`/Shorts/embed/live),
  Vimeo, direct `https` MP4/WebM, images and GIF/WebP.
- **Media cards** rendered inside the chat card (thumbnail + play button +
  provider + submitter), respecting the chat's width, layout, both vertical and
  horizontal modes, animations and shine.
- **Center video player** on a separate layer above the chat, with play/pause,
  seek ±(step), volume/mute, progress bar, current/duration, previous/next,
  replay, fullscreen, keyboard control and auto-close.
- **Video queue** with dedup, per-user limits/cooldown, `manual` / `auto-next` /
  `admin-approved` modes and an optional on-screen panel.
- **Media moderation**: domain allow/block lists, max duration, approval,
  duplicate protection.
- **Advanced role themes** for normal/member/prime/vip/moderator/owner/superchat
  (background/gradient/glass/image, border, glow, text/username colors, badge,
  animation, shine) — gated by a master switch, falling back to the existing
  member highlight when off.
- **Event/rule engine foundation** (extensible conditions → actions) driving the
  built-in rules (media → card, member → theme, super chat ≥ threshold →
  highlight).

## No paid API
Playback uses the **YouTube IFrame Player** (free, no Data API key). The
existing live-chat reader keeps its own YouTube Data API key; the player never
needs it. If the IFrame API can't load, the player falls back to a plain embed
iframe. Metadata that would require the Data API is skipped gracefully (video
ID, embed, thumbnail from `i.ytimg.com`, and the original URL are used instead).

## Security
Every chat message is untrusted. URLs are parsed with the URL API; only `https`
+ recognised providers are accepted. `javascript:`, `data:`, credential-bearing
URLs and unknown hosts are rejected. Player/iframe URLs are built only from
validated provider IDs. All text is written with `textContent` (never
`innerHTML`). Thumbnails are limited to an image-host allowlist / validated
image URLs. The editor⇄preview bridge validates `postMessage` origin.

## OBS / interaction note (important)
An OBS Browser Source is an **output**; stream viewers cannot click it. So:
- **Cards are clickable** wherever pointer interaction exists (dashboard preview,
  a browser, or an OBS "Interact" window).
- For hands-off playback in OBS, enable **Events → Auto-open media** with
  **Media Queue → Auto-next**; approved links then play automatically.
- The live overlay exposes `window.overlayRenderer` so a stream-deck bridge or
  interaction window can call `overlayRenderer.queue.playNext()` etc.

## New settings groups (schema-driven, all have defaults)
`media`, `mediaPlayer`, `mediaQueue`, `mediaModeration`, `roleThemes`,
`role_member`, `role_prime`, `role_vip`, `role_moderator`, `role_owner`,
`role_superchat`, `eventRules`. Saved settings without these fields are merged
with defaults automatically, so old configs never break. Values are clamped
server-side in `save-settings.php` against the schema.

## Deploy (assets only)
Upload to the folder serving `https://varshneyji.com/obs/`, keeping paths:

    assets/renderer.js  assets/renderer.css  assets/settings.schema.json
    assets/editor.js    assets/editor.css    assets/preview.js
    assets/preview.html assets/live.js

Then hard-refresh (assets are version-stamped by file mtime). No `install.php`,
no database change, no PHP change. `view.php`/`overlay.php` are unchanged.
