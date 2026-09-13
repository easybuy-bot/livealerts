# Database

Central MySQL is the source of truth.

## Core
- `users`: canonical identity. PK `id`.
- `products`: product catalog. YouTube product uses `slug=youtube-live-alerts`, `kind=youtube_live`.
- `access_keys`: licenses. FK `product_id -> products.id`, `user_id -> users.id`; status/expiry control access.
- `audit_logs`: admin/user actions.

## Existing OBS/camera
- `overlays`, `chat_sources`, `chat_messages`: OBS chat overlays and shared polling source.
- `camera_*`: Live Camera Studio resources, all owned by `users.id` through studios/devices.

## YouTube Live
- `youtube_connections`: OAuth/channel/live state for one canonical user. FK `user_id -> users.id`.
- `youtube_live_overlays`: secure OBS browser sources with random `token`; owner `user_id`.
- `youtube_live_templates`: immutable system templates.
- `youtube_live_user_templates`: cloned/editable user templates.
- `youtube_live_alert_assignments`: maps event types to user templates per overlay.
- `youtube_live_media`: uploaded media metadata, owner-enforced by `user_id`.
- `youtube_live_events`: normalized alert/event history.
- `youtube_live_milestones`: milestone alert settings.
- `youtube_live_oauth_states`: short-lived OAuth CSRF states.

```text
users
├── access_keys ── products
├── overlays ── chat_sources ── chat_messages
├── camera_studios ── camera_devices/scenes/streams
├── youtube_connections
├── youtube_live_overlays ── youtube_live_alert_assignments ── youtube_live_user_templates
├── youtube_live_media
├── youtube_live_events
└── youtube_live_milestones
```

All protected YouTube routes must validate: authenticated canonical user, active `youtube_live` product, active/non-expired access key, product active state, and resource ownership.
