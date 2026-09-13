# Live Camera Studio (v5)

A new product that turns a DJI / RTMP / SRT camera into a single, clean OBS
Browser Source with live scene switching, AI face blur, privacy zones,
recording and analytics. It is **added alongside** the existing chat overlays —
the overlay/chat pipeline is untouched.

## Architecture

```
 DJI / RTMP camera ──RTMP/SRT──▶ MediaMTX ──▶ AI worker (face blur) ──▶ MediaMTX
                                    │  ▲                                   │
                     on_publish /   │  │ signed HMAC webhook               │ WHEP / HLS
                     on_unpublish ──┘  │ (camera-webhook.php)              ▼
                                       └──────────────  OverlayHub  ◀── obs.php / live.php
                                                          (this PHP app)
```

- **PHP app (this repo):** store product, studio dashboard, scenes, credentials,
  OBS output, REST API, admin console. Runs on normal PHP/MySQL hosting.
- **Media stack (`deploy/camera/`):** RTMP/SRT ingest, WebRTC/HLS playback and
  the GPU/CPU face-blur worker. Runs as Docker on a VPS. See its README.

## Data model (all additive `camera_*` tables)

| Table | Purpose |
|---|---|
| `camera_studios` | tenant workspace per redeemed key; holds the OBS token, feature flags & limits |
| `camera_devices` | cameras (DJI/RTMP/SRT/WebRTC) with a unique ingest `stream_path` |
| `camera_credentials` | `api_key` + `stream_key` secrets (SHA-256 hashed, scoped) |
| `camera_streams` | live stream sessions (status, resolution, viewer peak) |
| `camera_scenes` / `camera_scene_elements` | scenes + placed elements (camera/text/image/overlay) |
| `camera_privacy_zones` | fixed blur regions per camera |
| `camera_processing_profiles` / `camera_audio_profiles` | video/audio settings |
| `camera_recordings` / `camera_snapshots` | recordings & stills |
| `camera_analytics` | time-series metrics (viewers, etc.) |
| `camera_webhooks` | inbound/outbound webhook log |

The product enums are widened idempotently: `products.category` gains `camera`,
`products.kind` gains `camera`.

## User flow

1. Admin issues a **Live Camera Studio** access key (admin → API keys).
2. User redeems it on the dashboard → a **Studio** is provisioned with a default
   scene, processing/audio profiles, an API key and a stream key.
3. User adds cameras (each shows an ingest URL + a one-time stream key), builds
   scenes and clicks **Go live** to switch what OBS shows.
4. In OBS, add **one** Browser Source: `/obs.php?t=<OBS token>`. This URL is
   permanent; scene switches happen live via `camera-status.php` polling.

## Connect a camera (OBS & DJI Mimo)

Every camera publishes to the media server with two parts:

- **Server (RTMP):** the value of `MEDIA_RTMP_INGEST` — e.g.
  `rtmp://cam.yourdomain.com:1935/live` (same for every camera).
- **Stream key:** `<stream-path>?key=<stream-key>` where `<stream-path>` is the
  camera's path shown in the Cameras table (e.g. `cam_ab12…`) and
  `<stream-key>` is the one-time secret revealed when you add the camera or
  click **Stream key**.

Adding a camera (or regenerating its key) shows the exact, filled-in values
ready to copy.

### OBS Studio
Settings → Stream → Service **Custom…**
- **Server:** `rtmp://cam.yourdomain.com:1935/live`
- **Stream Key:** `cam_ab12…?key=ovhs_…`

### DJI Mimo (Osmo Pocket / Action etc.)
Live Streaming → choose **RTMP** (custom platform) → paste the single full URL:
```
rtmp://cam.yourdomain.com:1935/live/cam_ab12…?key=ovhs_…
```
→ Start Live. DJI Mimo uses one field, so the stream key is appended to the URL
after the path. (If a device's firmware rejects the `?key=` query string, click
**Stream key** to rotate it and use OBS on a phone/PC, or the SRT form below.)

### SRT (low-latency alternative)
```
srt://cam.yourdomain.com:8890?streamid=publish:cam_ab12…?key=ovhs_…
```

The media server calls `camera-webhook.php` (`on_publish`) with the path + key;
a valid key is authorized and the camera goes live, an invalid one is rejected.

## REST API (`camera-api.php`)

Auth: `Authorization: Bearer ovhk_…`. JSON in/out. Each key is bound to one
studio; scopes gate every action.

| Action | Method | Scope |
|---|---|---|
| `studio` | GET | `camera:read` |
| `devices` | GET | `camera:read` |
| `device.add` | POST | `camera:write` |
| `scenes` | GET | `camera:read` |
| `scene.switch` | POST | `scene:switch` |
| `stream.start` / `stream.stop` | POST | `stream:start` / `stream:stop` |
| `snapshot` | POST | `snapshot` |
| `recording.start` / `recording.stop` | POST | `recording` |
| `analytics` | GET | `analytics` |

Errors: `401` (bad/missing key), `403` (missing scope), `404`
(not found / not in this studio), `405` (method), `422` (validation).

## Media-server webhook (`camera-webhook.php`)

Called by MediaMTX. Body is signed with `X-OVH-Signature`
(HMAC-SHA256 over the raw body using `MEDIA_WEBHOOK_SECRET`).

- `publish { path, key, … }` → authorizes by the per-device stream key; `200`
  opens a session (device → streaming), `403` rejects.
- `unpublish { path }` → ends the session (device → online).
- `viewers { path, viewers }` → records an analytics sample + viewer peak.

## Admin

Admin → **Cameras**: list all studios with counts and live indicator; drill in
to toggle features (recording / AI blur / WebRTC), set limits, revoke
credentials and end sessions.

## Security summary

- Ownership scoping on every model read/write (multi-tenant isolation).
- Secrets random + SHA-256 hashed; raw shown once; stream keys rotatable.
- Webhooks HMAC-authenticated; OBS token exposes only the composed scene.
- CSRF on all studio/admin forms (existing `csrf_field()` / `csrf_check()`).

## Configuration (`config.php`)

`MEDIA_RTMP_INGEST`, `MEDIA_SRT_INGEST`, `MEDIA_WHEP_BASE`, `MEDIA_HLS_BASE`,
`MEDIA_WEBHOOK_SECRET` — point these at your `deploy/camera/` media stack.
