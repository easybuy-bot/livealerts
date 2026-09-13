# Automatic channel-based live chat (v4.3)

Connect a **YouTube channel once**; OverlayHub automatically finds the current
live stream + its chat, reconnects whenever you go live again, and keeps
monitoring after a stream ends. Manual (single live video) mode still works.

## Two modes (dashboard → Chat source)
- **Automatic — YouTube channel** (recommended): paste your channel URL / @handle.
- **Manual — single live video**: paste a live video URL/ID (legacy, unchanged).

Both need a free **YouTube Data API v3** key.

## Automatic detection flow
```
Channel URL/@handle → resolveChannel() (official channels.list) → channel id + uploads playlist
   → findActiveLiveVideo() (uploads playlist + videos.list) → current videoId + activeLiveChatId
   → LivePoller polls the chat → shared buffer → vertical + horizontal overlays
Stream ends  → live info cleared, live_status='ended', channel stays connected → keeps monitoring
New stream   → different videoId detected → old buffer cleared → reconnect to new chat
```

## Quota / polling strategy (important)
- **Discovery is cheap and never per-second.** While offline we look for a live
  via the channel's **uploads playlist** (`playlistItems.list`, 1u) +
  `videos.list?part=liveStreamingDetails` (1u) — NOT `search.list` (100u).
  Throttled to once per `LivePoller::DISCOVERY_INTERVAL` (60s) while offline.
- **Chat polling** only runs once a live chat is known, reusing the existing
  per-source throttle (≥3.5s, honours YouTube's `pollingIntervalMillis`).
- **One channel = one resolver = one source.** A key's vertical + horizontal
  overlays share one `chat_source`; only one poll per source feeds all overlays.

## Files
- `lib/YouTube.php` — `parseChannelInput`, `resolveChannel`, `findActiveLiveVideo`,
  `uploadsPlaylistId`; injectable HTTP transport for tests.
- `lib/LivePoller.php` (new) — `runChannel`, `runManual`, `connectChannel`,
  `pollChat`, `ingest`, `trim`, `friendlyError`.
- `chat.php` — routes YouTube sources to LivePoller by `yt_mode`.
- `overlay.php` / `php/overlay.php` — Automatic/Manual UI + connect + live status.
- `source-status.php` (new) — owner-only live status JSON for the dashboard.
- `inc/db.php` — additive migration on `chat_sources`.
- `lib/Overlay.php` — exposes new source columns.

## Database (additive, backward-compatible)
New nullable columns on `chat_sources` (existing YouTube rows default
`yt_mode='manual'`, so nothing changes for them):
`yt_mode, yt_channel_url, yt_channel_id, yt_channel_title, yt_uploads_playlist,
live_video_title, live_status, last_checked_at`.
No table drops, no data loss; the installer/migration is idempotent.

## API endpoints used (official YouTube Data API v3)
`channels.list` (forHandle / forUsername / id), `playlistItems.list`,
`videos.list` (liveStreamingDetails, snippet), `liveChat/messages`.
No HTML scraping, no unofficial endpoints. The API key stays server-side only.

## Error handling
Invalid URL, channel-not-found, quota, invalid/forbidden key, and network errors
map to friendly messages. Offline channel is **not** an error. A naturally ended
chat returns to monitoring rather than breaking the connection. Nothing shows
"Connected" unless the backend actually verified it.

## State (per source)
`source_type, yt_mode, yt_channel_url/id/title, yt_uploads_playlist,
yt_video_id (current, temporary), live_chat_id (current, temporary),
live_video_title, live_status (detecting|live|offline|ended|error),
last_checked_at, last_poll_at, last_message_at, last_state, last_reason`.
