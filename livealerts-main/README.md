# LiveAlerts — Multi-user YouTube Live Alert & Animated Overlay Platform

A production-oriented, standalone platform for streamers: connect a YouTube channel,
detect live streams automatically, and turn live events (Super Chat, Super Sticker,
new members, gifts, subscribers, live start/end, milestones) into **animated OBS
alerts** built from a structured, fully-customizable **Template Library**.

**Stack:** Node.js (≥22.5) · Express · Socket.IO · SQLite (built-in `node:sqlite`) ·
Google/YouTube Data API v3. No external database required — the app is fully
self-contained and runs with a single `npm install && npm start`.

---

## 1. Quick start

```bash
npm install
cp .env.example .env          # then fill in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
npm start                     # http://localhost:3000
```

1. Register an account.
2. Dashboard → **Connect YouTube** (Google OAuth).
3. **Templates** → pick a template → **Use Template** (this clones it — the master is never modified).
4. **Alert Builder** → customize, preview, **Test Alert**, **Save**.
5. **Overlays** → copy the **Browser Source URL** → add it to OBS as a Browser Source.
6. Go live — events flow automatically.

> **YouTube OAuth setup:** in Google Cloud Console create an OAuth 2.0 Client ID
> (type *Web application*). Authorized redirect URI must be
> `SITE_URL/api/youtube/callback`. Enable the **YouTube Data API v3**.

### Deploying

The app needs a **long-running process with a writable disk** (Socket.IO
connections, a SQLite file and uploaded media) — so serverless hosts such as
Vercel/Netlify and PHP-only shared hosting will not work. A VPS, Railway,
Render or Fly all work.

`Dockerfile` + `railway.json` are included; see **[DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md)**
for the full walkthrough (volume, variables, domain, OAuth, troubleshooting).

`RENDER_EXTERNAL_HOSTNAME`, so the OBS Browser Source URLs are correct on first
boot. Keep the service at **one replica** — SQLite and the alert queue are
single-process.

---

## 2. Architecture

```
                 USER
                  │
                  ▼
           AUTHENTICATION (scrypt sessions)
                  │
                  ▼
         YOUTUBE CONNECTION (OAuth2, tokens AES-256-GCM encrypted at rest)
                  │
                  ▼
            LIVE DETECTION  ──(offline: channels.list → playlistItems.list → videos.list)
                  │
                  ▼
            EVENT LISTENER  ──(live: liveChatMessages.list polling, dedup by message id)
                  │
                  ▼
           EVENT NORMALIZER ──(raw YouTube → internal normalized event)
                  │
                  ▼
             ALERT ENGINE  ──(rules + amount conditions + priority + per-overlay queue)
                  │
          ┌───────┴────────┐
          ▼                ▼
    ALERT TEMPLATE    ALERT QUEUE
          │                │
          └───────┬────────┘
                  ▼
          ANIMATION ENGINE (overlay renderer: WAAPI + canvas particles + WebAudio)
                  │
                  ▼
              WEBSOCKET (Socket.IO, per-overlay room — never global broadcast)
                  │
                  ▼
           BROWSER OVERLAY → OBS
```

**Key separation of concerns** (each is its own module under `server/services/`):

| System | File |
| --- | --- |
| YouTube connector | `youtubeClient.js` |
| Live discovery | `liveDetector.js` |
| Live event processing | `chatPoller.js` |
| Subscriber / milestone monitor | `subscriberMonitor.js` |
| Pipeline orchestrator | `pipeline.js` |
| Event normalization | `normalizer.js` |
| Alert engine + queue | `alertEngine.js` |
| Template system | `templateLibrary.js` + `seeds/templates.js` |
| Realtime routing | `realtime.js` |
| Defaults | `defaults.js` |

---

## 3. Database schema (SQLite)

`users`, `sessions`, `youtube_connections`, `templates` (system, immutable),
`user_templates` (clones), `overlays`, `alert_assignments`, `media`, `events`,
`favorites`, `template_usage`, `milestones`, `oauth_states`.

- **System templates vs user templates** — `templates.is_system = 1` are the
  platform masters. A user never edits them; "Use Template" clones into
  `user_templates` (independent copy, so master updates never break user work).
- **Ownership** — every user-scoped table carries `user_id` and every query
  filters by it (enforced server-side, never trusted from the frontend).

---

## 4. Authentication & YouTube OAuth flow

- Registration/login with `crypto.scrypt` password hashing and opaque,
  revocable session tokens (httpOnly cookie).
- YouTube connect: `GET /api/youtube/auth-url` → Google consent (offline,
  `prompt=consent` to always get a refresh token) → `GET /api/youtube/callback`
  exchanges the code, reads the channel, and upserts the connection.
- **Access + refresh tokens are AES-256-GCM encrypted** with a key derived from
  `APP_SECRET` and are never sent to the browser.

## 5. Event detection flow

- **Live discovery** (offline, quota-friendly ~3 units/check): `channels.list`
  (uploads playlist id) → `playlistItems.list` (latest videos) → `videos.list`
  (`liveBroadcastContent === "live"`). Default interval 2 min + jitter.
- **Live event processing** (while live): `liveChatMessages.list` polling
  (default 4 s + jitter), deduplicated by message id.
- **Subscribers/milestones**: `channels.list` statistics polling (5 min) —
  subscriber *count* deltas are emitted as SUBSCRIBER alerts and threshold
  crossings as MILESTONE alerts (YouTube's live-chat API does not expose
  individual subscriber names — see §26).

## 6. Event normalization

Raw YouTube items are mapped to canonical internal events:

| Internal type | YouTube source |
| --- | --- |
| `SUPER_CHAT` | `superChatEvent` (amountMicros → units) |
| `SUPER_STICKER` | `superStickerEvent` |
| `NEW_MEMBER` | `newSponsorEvent` |
| `MEMBER_MILESTONE` | `memberMilestoneChatEvent` |
| `GIFT_MEMBERSHIP` | `sponsorshipGiftPurchaseEvent` |
| `GIFT_MEMBERSHIP_RECEIVED` | `sponsorshipGiftRedemptionEvent` |
| `SUBSCRIBER` | subscriber-count delta (statistics) |
| `LIVE_START` / `LIVE_END` | live-detection transitions |
| `MILESTONE` | subscriber-count threshold crossing |

The Alert Engine operates only on these normalized events.

## 7. Alert Engine

- Resolves the user's overlays → enabled `alert_assignments` for the event type
  → filters by amount conditions (`minAmount`/`maxAmount`) → picks a template
  (random variation among matching assignments) → queues per overlay.
- **Priority**: higher-priority alerts jump ahead of queued ones.
- **Queue**: sequential per overlay, paced by the template's `duration`.
- **Test mode** (`POST /api/my-templates/:id/test`) runs synthetic events through
  the *exact same* engine path.

## 8. Template Library

- **52 structured system templates** across Subscriber, Super Chat, Super
  Sticker, Member, Gift Membership, LIVE Start, LIVE End, and Milestone.
- Categories: Classic, Minimal, Neon, Gaming, Fire, Celebration, Cute,
  Cyberpunk, Luxury, Retro, Futuristic, Halloween, Christmas, Money, Royal,
  Epic, VIP, Fullscreen.
- Filters: event, category, orientation (16:9 / 9:16 / 1:1), free/premium,
  search, popular/recent. Favorites + Recently Used.
- Every template is a **JSON configuration** (canvas, background, layers,
  animations, timeline, sound, variables) — never a flattened image.

## 9. Template cloning

`Use Template` → `cloneTemplateForUser()` inserts a new `user_templates` row.
The master template is immutable; user edits touch only their clone.

## 10. Alert Builder

Visual editor: layer list (add/reorder/delete text, image, particles), live
preview (same renderer as OBS), and property panels for background (solid,
gradient, animated gradient, image, video, particles + effects + animation),
text (font/size/weight/color/glow/spacing/position), animations (entrance /
idle / exit with duration & delay), sound, and alert duration.

## 11. Layer system

`background` + ordered `layers[]`: text, image (circle/rounded/square), and
particles. Each layer has position, style, and entrance/idle/exit animations.

## 12. Background system

Solid, gradient, image, GIF/video, animated gradient, particles, transparent;
effects (blur/brightness/contrast/saturation/opacity/glow); animations
(zoom/pan/rotate/pulse).

## 13. Animation engine

Web Animations API keyframes: fade, slide, zoom, pop, bounce, elastic, flip,
rotate, glitch, blur-reveal (entrance); pulse, float, shake, glow (idle);
fade, slide, zoom (exit). Canvas particle systems and WebAudio-synthesized
sounds (no external audio files required).

## 14. Timeline

Each layer's entrance/idle/exit carries duration + delay; the alert's total
`duration` drives the queue pacing. (A full keyframe editor is a documented
next phase.)

## 15. Sound system

Built-in synthesized sounds (`builtin:money`, `builtin:subscriber`, …) plus
user-uploaded audio via the Media library.

## 16. Media storage

`POST /api/media` (multer) stores images/GIFs/videos/sounds/backgrounds under
`data/uploads/{userId}/` with unguessable random filenames; served at
`/uploads/{userId}/{file}`. Upload/delete are ownership-enforced.

## 17. WebSocket architecture

Socket.IO rooms: `overlay:{token}` for browser sources and `user:{id}` for
dashboards. Events are emitted only to the matching overlay room — never
globally. One YouTube connection → one pipeline → many overlay consumers.

## 18. Browser Source

`GET /overlay/{token}` serves the transparent, animated overlay page. The token
is a 192-bit random value, regenerable and revocable per overlay.

## 19. Multi-user isolation

Every resource (connection, tokens, templates, overlays, media, events,
assignments, milestones) is scoped to `user_id` and enforced server-side.
Covered by an automated test (user B receives 404 on user A's resources).

## 20. Security

- OAuth tokens encrypted at rest; never exposed to the browser.
- scrypt password hashing; revocable sessions.
- Secure random overlay tokens + regeneration.
- Server-side ownership checks on every query.
- Uploads size-limited and random-named.

## 21. API quota strategy

Live discovery (~3 units/check, 2 min cadence) is fully separated from live
event processing (1 unit/poll, 4 s cadence). Jitter avoids thundering herds;
errors trigger reconnect/backoff rather than tight retry loops.

## 22. Connection state machine

`OFFLINE → DETECTING → LIVE → RECONNECTING/ERROR`, with the channel connection
retained across stream end and automatic re-detect on the next stream.

## 23. Files / modules created

```
server/            Express app, routes, services, seeds (see §2 table)
overlay/           OBS browser source + data-driven animated renderer
public/            Landing, auth, dashboard, library, builder, overlays,
                   media, history (vanilla JS SPA)
scripts/           seed.js, e2e.mjs, shots.mjs
tests/             core.test.js (unit), api.test.js (integration)

overlay/alert.css      alert component styles (shared: OBS + in-app previews)
overlay/renderer.css   OBS page chrome only (reset, html/body, #stage)
public/my-templates.*  My Templates: edit/rename/duplicate/test/delete
```

## 24. Database migrations

Schema is idempotent `CREATE TABLE IF NOT EXISTS` (see `server/db.js`), applied
at boot; `npm run seed` re-seeds the template library idempotently.

## 25. Tests performed

- **Unit** (`npm test`): crypto round-trip, password hashing, event
  normalization, template seeding, clone immutability.
- **Integration**: full user flow (register → overlay → clone → test → history),
  multi-user isolation, auth rejection.
- **E2E** (`npm run e2e`, Playwright + Chromium): landing, register, dashboard,
  overlay creation, library rendering, server-driven categories, favorites /
  recently-used, builder preview/save, builder layout, preview fit,
  My Templates rename/duplicate/delete, a live WebSocket alert rendering in
  the overlay, plus the onboarding checklist, OBS guide, overlay orientation,
  help centre, builder unsaved/undo state, media dropzone and CSV export. The E2E run boots its own server on a random port with a
  throwaway database, so it never collides with a running dev server.
- **All 18 unit/integration tests and 31 E2E checks pass.**

### Audit & repairs (post-review pass)

A full static + runtime audit was run over the codebase (unresolved imports,
dead exports/imports/locals, frontend↔backend route contract, unreachable
endpoints). Findings and fixes:

| # | Issue | Fix |
|---|-------|-----|
| 1 | **Media uploads always stored `kind: "image"`** — `req.body.kind` was read before multer parsed the multipart body | Parse upload first, then validate `kind`; unlink the file on invalid kind |
| 2 | **Template previews broken app-wide** — `renderer.css` (needed for `.la-alert`/`.la-layer` positioning) was never loaded on library/builder pages, so every layer was translated off-canvas | Split into `alert.css` (component) + `renderer.css` (OBS page chrome); app pages load `alert.css` |
| 3 | **Builder layout blowout** — `renderer.css`'s `#stage { width: 1920px }` collided with the builder's `#stage`, inflating the grid track to 1920px and pushing the properties panel off-screen | Stylesheet split (above) + `min-width: 0` on builder grid items |
| 4 | **Previews rendered unscaled** — `max-width: 100%` clipped the box without scaling the 1920×1080 design | Added `fit` mode: real design size + `transform: scale()` with a `ResizeObserver` |
| 5 | **Landing page unreachable when logged out** — `api()` force-redirected on 401, and the landing page probes `/api/auth/me` | Added `allow401` so a session probe doesn't redirect |
| 6 | **`npm test` was broken** — Node 24 rejects `--test tests/` as a directory | Use a glob: `--test "tests/*.test.js"` |
| 7 | **`/api/admin/stats` was unreachable** — `is_admin` could never be set | Added `ADMIN_EMAILS` config, granted on register and synced on login |
| 8 | **Spec §23/§24 endpoints had no UI** — `/templates/favorites` and `/templates/recent` were dead | Added "My Favorites" + "Recently Used" sections to the library |
| 9 | **Spec §25 "My Templates" page missing** — `DELETE /api/my-templates/:id` had no caller | New page with Edit / Rename / Duplicate / Test / Delete |
| 10 | **Categories hardcoded in the frontend** (violates spec §74) | Library now loads `/api/templates/categories` from the server |
| 11 | **Spec §61 `ERROR` state never used** — permanent auth failures retried forever, burning quota | Added `isAuthError()`; revoked/expired grants park in `ERROR` and stop polling |
| 12 | **`recordUsage()` imported but never called**; clone duplicated the insert inline | Clone now calls `recordUsage()` (single source of truth) |
| 13 | **13 dead imports, 5 dead locals, 2 dead exported functions** (`setConnectionError`, `clearConnectionError`) | All removed; audit now reports zero dead imports/locals |
| 14 | **Preview audio** played on every builder re-render | `preview()` is now silent by default |

Regression tests were added for items 1, 2, 3, 4, 5, 7, 8, 9, 10 and 12.

### Usability pass (second review)

The app was correct but assumed the user already knew OBS and the alert model.
This pass added guidance and safety rails, and fixed two real bugs found while
building them:

| Area | Change |
|------|--------|
| **Dashboard** | **Getting started** checklist with a progress bar. All six steps are auto-detected from real data (connection, overlays, templates, events) so it can never go stale, each has a one-click CTA, and it can be hidden once complete. |
| **OBS onboarding** | New shared **OBS setup guide** modal (`App.obsGuide`): copy button for the Browser Source URL, the six exact OBS steps with your overlay's real width/height, the "Shutdown source when not visible" warning, **Send test alert**, and **Open overlay in a tab**. It opens automatically right after an overlay is created and from **Show me how** on the Overlays page. |
| **Overlays — bug fix** | Canvas size is now a **preset picker** (1920×1080, 1280×720, 1080×1920, 1080×1080, custom). Previously width and height were independent dropdowns and `orientation` was **hardcoded to `16:9`**, so a 1080×1920 vertical overlay was stored as landscape and matched the wrong templates. Orientation is now derived from the chosen size. |
| **Overlays — assignments** | The assignment rows were six unlabelled boxes. They now have a column header (Event / Template / Priority / Min ₹ / Max ₹ / On), tooltips, an "amount limits only apply to Super Chat / Sticker / milestones" note, a "saves automatically" hint, and a warning that the Browser Source URL is private. |
| **Builder — safety** | **Unsaved changes** badge, the Save button reflects state (`Saved` / `Save changes`), **Undo/Redo** (60-deep debounced snapshot stack), `Ctrl+S` / `Ctrl+Z` / `Ctrl+Shift+Z`, a `beforeunload` guard, confirmation before switching template or deleting a layer, and an empty state that links to the library. |
| **Builder — bug fix** | Editing **Alert duration** rebuilt the properties panel from inside the input's own `change`/`blur` handler, which removed the focused node mid-event and threw `Failed to set the 'innerHTML' property`. Only the affected pieces re-render now. |
| **Builder — test target** | **Test Alert** used to silently fire at the oldest overlay. With two or more overlays there is now a picker (remembered per browser), and the toast names the overlay and warns when the template has unsaved edits. |
| **Media** | Drag-and-drop (or click) **dropzone** with multi-file upload and per-file progress, the group auto-detected from the file's MIME type, the real `MAX_UPLOAD_MB` limit surfaced from the API, oversized files rejected before uploading, and a useful empty state. |
| **History** | Relative timestamps (full date on hover), **Export CSV**, and an empty state that explains how to produce an event. |
| **Library** | A "how this works" note explaining that **Use Template** copies the design into your account, a helpful no-results state, Favorites / Recently Used capped to one row each so the library stays above the fold, and a larger lazy-preview margin so previews are already animating when you scroll. |
| **Everywhere** | **Help** button in the nav opens an in-app troubleshooting centre (six topics, including "my alert is not showing in OBS"), plus a shared `App.modal()` and a clipboard helper with a non-secure-context fallback. |

Eleven new E2E checks cover the checklist, the OBS guide, the orientation fix,
the labelled assignment columns, the help centre, the unsaved badge, undo, the
media dropzone limit and the CSV export.

Remaining intentionally-uncalled endpoints (verified, not dead):
`GET /api/youtube/callback` (Google OAuth redirect target) and
`GET /favicon.ico`. The 401 logged in the browser console on the landing page is
the expected response to the logged-out session probe.

## 26. Known API limitations

- **Subscriber names are not available** via official YouTube APIs — subscriber
  alerts are derived from subscriber-count deltas and show a generic name.
  Milestones use the same count source.
- **Super Sticker artwork** is not exposed as an image URL by the API; the
  renderer shows a placeholder. (You can map sticker ids to artwork later.)
- Live-chat polling is subject to YouTube rate limits; very high-traffic
  streams may need a quota increase or Pub/Sub push (next phase).
- `node:sqlite` is marked experimental in Node 22/24 (stable API in practice).

## 27. Recommended next phase

1. YouTube **Pub/Sub (push)** or a queue worker for high-traffic chat.
2. **Keyframe timeline editor** in the Alert Builder — spec §37/§38 are the one
   major area still unbuilt: templates carry per-layer entrance/idle/exit
   animation configs (duration, delay, easing, loop) and the renderer honours
   them, but there is no timeline/keyframe UI and no `keyframes` array in the
   template schema yet.
3. **Template import/export** (safe JSON, no arbitrary JS).
4. **Payments** (Stripe) to unlock Premium templates — the model already
   supports `is_premium`.
5. **Analytics dashboard** (per-stream revenue, top supporters, trends).
6. **Milestone editor UI** (currently API/DB-backed).
7. Horizontal scaling: move the queue + Socket.IO to Redis for multi-instance.
