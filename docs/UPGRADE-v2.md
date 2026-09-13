# Upgrade to v2 — horizontal mode, multi-overlay, hardened custom HTML

This upgrade is **additive and backward-compatible**. Existing keys, OBS tokens,
overlay URLs and the live chat feed keep working. Follow the steps in order.

## 0. Before you start (5 min)
- **Back up the database.** In cPanel → phpMyAdmin, export the whole schema
  (Custom → all tables → SQL). Keep the `.sql` file.
- **Back up the current site folder.** In cPanel File Manager, compress the
  `public_html/obs/` folder to a zip and download it. This is your rollback.
- Confirm `config.php` on the server already has the correct DB name / user /
  password (do **not** overwrite the live `config.php`).

## 1. Upload the changed files
Upload these into the folder that serves https://varshneyji.com/obs/ , keeping
the same paths. Overwrite the existing files.

    assets/renderer.js
    assets/renderer.css
    assets/settings.schema.json
    assets/preview.js
    assets/preview.html
    assets/editor.js
    inc/db.php
    inc/helpers.php
    lib/Overlay.php
    chat.php
    save-settings.php
    dashboard.php
    admin/products.php

Two files live in `php/` in the repo but deploy to the site **root** (this is
how the site has always been deployed):

    php/overlay.php   ->   public_html/obs/overlay.php
    php/view.php      ->   public_html/obs/view.php

Do **not** upload `config.php`, `install.php` stays as below, and you do not
need to touch `inc/`/`lib/` `.htaccess` files.

## 2. Run the one-time database migration
Open once in a browser (logged in as admin is fine):

    https://varshneyji.com/obs/install.php

This calls `migrate()`, which is **idempotent** — it only creates the
`chat_sources` table, adds the new columns to `products`, `overlays` and
`chat_messages`, relaxes the old `UNIQUE(access_key_id)` on `overlays`, and
backfills a shared chat source + `source_id` for every existing overlay/message.
Running it more than once is safe.

You should see the normal "installed / up to date" result. Then **delete
`install.php`** from the server again (security).

## 3. Hard-refresh and verify
- Open the dashboard and hard-refresh (Ctrl/Cmd+Shift+R). Asset URLs are
  version-stamped by file mtime, so browsers pick up the new JS/CSS.
- Open **Manage overlay** for an existing key. You should see your existing
  overlay listed (Vertical mode) plus controls to add another overlay, a Chat
  source panel, and a Health panel.
- Your existing OBS Browser Source URL/token is unchanged — the live overlay
  keeps rendering.

## 4. Smoke test the new features (optional but recommended)
- In Manage overlay, click **Add overlay → Horizontal**. Open its OBS URL in a
  browser tab: messages should travel left→right. The original vertical overlay
  keeps working from the same key at the same time.
- Admin → Products → add or edit a **Custom (HTML)** product: use **Validate**
  and **Preview** before saving; try **Restore previous** after a second save.

## Rollback
If anything looks wrong:
1. Restore the site folder from the zip you downloaded in step 0.
2. The new columns/tables are additive and are ignored by the old code, so you
   normally do **not** need to touch the database. If you want a clean revert,
   import the `.sql` backup from step 0.

## Notes / limitations
- **YouTube quota unchanged or lower:** because all overlays on a key now share
  ONE polled source, running several overlays no longer multiplies API calls.
- The overlay still polls on-demand from open browser sources; the optional cron
  worker in `DEPLOYMENT.md` still applies if you want to scale.
