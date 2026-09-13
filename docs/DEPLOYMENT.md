# Deployment notes

## Requirements
- PHP 8.1+ with PDO MySQL and cURL extensions.
- MySQL 5.7+ / MariaDB 10.3+.
- HTTPS strongly recommended (OBS Browser Source and cookies work best over HTTPS).

## Shared hosting (cPanel etc.)
1. Create a database + user, grant all privileges.
2. Set the values in `config.php`.
3. Upload files, open `/install.php`, then delete it.
4. Done — polling runs on-demand from each open overlay, no background service needed.

## YouTube Data API
- In Google Cloud Console: create a project → enable **YouTube Data API v3** → create an
  **API key**. The user pastes this key + their live video URL in the overlay settings.
- Default quota is 10,000 units/day. `liveChat/messages` costs ~1–5 units per poll, and the
  app throttles to the interval YouTube returns, so a handful of concurrent streams is fine.

## Optional: cron worker for scale
Instead of polling YouTube on each browser request, run a cron every minute that fetches
messages for all active YouTube overlays into `chat_messages`. The browser then only reads
from the database. Sketch:

```
* * * * * /usr/bin/php /path/to/site/bin/poll.php >/dev/null 2>&1
```
(A `bin/poll.php` can loop active overlays and call the same YouTube reader in `lib/`.)

## Security checklist
- Change `APP_SECRET` and the seed admin password.
- Delete `install.php` after setup.
- Keep `inc/` and `lib/` blocked (the included `.htaccess` files do this on Apache;
  on nginx, deny `location ~ ^/(inc|lib)/`).
- Serve over HTTPS and set `SITE_URL` to the `https://` address.
```

## nginx (deny internal dirs)
location ~ ^/(inc|lib)/ { deny all; }
```
