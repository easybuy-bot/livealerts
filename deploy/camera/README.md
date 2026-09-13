# Live Camera Studio — media stack deployment

The OverlayHub PHP app (store, dashboards, scenes, credentials, OBS output,
REST API, admin) runs on your normal PHP/MySQL hosting. The **media pipeline**
below cannot run on shared hosting — it needs a VPS/root server with open ports
and (ideally) a GPU. It handles RTMP/SRT ingest, AI face blur + privacy zones,
and WebRTC/HLS playback.

```
 DJI / RTMP camera ──RTMP/SRT──▶ MediaMTX ──▶ worker (AI blur) ──▶ MediaMTX
                                    │  ▲                              │
                     on_publish/    │  │ signed webhook               │ WHEP/HLS
                     on_unpublish ──┘  │ (camera-webhook.php)         ▼
                                       └────────────  OverlayHub  ◀── obs.php / live.php
                                                        (PHP app)
```

## 1. Requirements
- A Linux VPS with a public IP and these ports open:
  - `1935/tcp` (RTMP ingest), `8890/udp` (SRT ingest)
  - `8889/tcp` + `8189/udp` (WebRTC/WHEP), `8888/tcp` (HLS)
- Docker + Docker Compose.
- (Optional) NVIDIA GPU + `nvidia-container-toolkit` for real-time face blur.
- TLS in front of `8889`/`8888` (a reverse proxy such as Caddy/Nginx) so the
  browser can play over HTTPS from your site.

## 2. Configure the PHP app
In `config.php` set the media endpoints to your server and a strong secret:
```php
const MEDIA_RTMP_INGEST    = 'rtmp://cam.yourdomain.com:1935/live';
const MEDIA_SRT_INGEST     = 'srt://cam.yourdomain.com:8890';
const MEDIA_WHEP_BASE      = 'https://cam.yourdomain.com:8889';
const MEDIA_HLS_BASE       = 'https://cam.yourdomain.com:8888';
const MEDIA_WEBHOOK_SECRET = 'a-long-random-secret';
```
Run `install.php` once (additive migration; no existing data is touched).

## 3. Configure the media stack
```bash
cd deploy/camera
cp .env.example .env
# edit .env: APP_WEBHOOK_URL, APP_API_BASE, MEDIA_WEBHOOK_SECRET (same as PHP),
#            WORKER_API_KEY (an ovhk_ key with camera:read + analytics)
docker compose up -d
```
Drop a face-detection model at `worker/models/face.onnx` for automatic face
blur (privacy zones work without it).

## 4. Point a camera at it
In the studio (`camera.php`) add a camera and copy its **stream key** (shown
once). Configure the camera / DJI app / OBS:
- **Server:** `rtmp://cam.yourdomain.com:1935/live`
- **Stream key:** `<stream_path>?key=<stream_key>`

MediaMTX calls `on_publish.sh`, which asks the PHP app to authorize the key
(`camera-webhook.php`). Valid → the stream goes live and a session is recorded;
invalid → the publish is rejected.

## 5. Put it in OBS
Add **one** Browser Source in OBS:
```
https://yourdomain.com/obs.php?t=<OBS token>
```
This URL never changes. Switch scenes live from the studio (or via
`scene:switch` on the REST API) and OBS updates in place.

## 6. Security notes
- Publish keys are per-device, hashed at rest, and rotatable ("Stream key").
- Webhooks are authenticated with HMAC-SHA256 (`MEDIA_WEBHOOK_SECRET`).
- REST API keys are scoped (`camera:read`, `stream:start`, `scene:switch`, …)
  and bound to a single studio — cross-tenant access is impossible.
- The OBS/viewer token only exposes the composed scene, never any secret.
- Put the whole media stack behind TLS and a firewall; only 1935/8890 need to
  be reachable by cameras, and 8888/8889 by viewers.

## Records & snapshots
Recording/snapshot rows are created by the app and by the media stack. Wire your
ops tooling (or MediaMTX `record:` + a cron uploader) to persist the files and
POST their final URLs back via `recording.stop` on the REST API.
