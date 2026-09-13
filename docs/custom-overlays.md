# Custom overlays (admin-uploaded HTML)

This adds a second kind of product to OverlayHub. Alongside the built-in **chat**
overlay, an admin can upload a **custom** overlay: a single self-contained HTML
file. Users then customise it from the same dashboard editor they already use for
the chat overlay — the controls are generated automatically from a schema you
embed in the HTML.

Nothing about the existing chat overlay changes.

---

## 1. One-time database upgrade

Two ideas are added to the `products` table: a `kind` column and two columns to
store the uploaded HTML and its schema. The upgrade is **idempotent** — it only
adds columns that are missing.

Run the installer once after uploading the new files:

    https://your-site/obs/install.php

(It calls `migrate()`, which now also runs the column upgrade. Delete
`install.php` again afterwards, as before.)

Columns added to `products`:

| column           | type                         | meaning                              |
|------------------|------------------------------|--------------------------------------|
| `kind`           | ENUM('chat','custom')        | 'chat' = the built-in overlay        |
| `overlay_html`   | MEDIUMTEXT NULL              | the uploaded HTML (custom only)      |
| `overlay_schema` | MEDIUMTEXT NULL              | JSON schema extracted from the HTML  |

Existing products keep working: they default to `kind = 'chat'`.

---

## 2. Add a custom product (admin)

Admin → **Products** → *Add a product*:

1. Set **Kind** = *Custom (uploaded HTML)*.
2. Upload your `.html` file (or paste the HTML). Max 3 MB.
3. Fill title / description / etc. as usual and save.

On save the platform reads the file, extracts the embedded schema, validates it
as JSON and stores both. If the schema block is missing or invalid, the product
is **not** saved and you get an error telling you what to fix.

Then create an **API key** for that product and hand it to a user exactly like
any chat overlay. The user redeems it, opens **Manage overlay**, and customises.

---

## 3. Writing a custom overlay (the contract)

Your file is one normal HTML document. Keep the page background transparent so
OBS composites it over the scene. See **`sample-custom-overlay.html`** in this
folder for a complete, working example (a lower-third banner).

### 3.1 Embed a schema

Add exactly one script tag of type `application/json` with `id="overlay-schema"`.
It describes the controls the editor should show. Same field types as the chat
overlay:

    <script type="application/json" id="overlay-schema">
    {
      "box": {
        "bgColor": { "type": "color",  "label": "Background", "default": "#6d28d9" },
        "radius":  { "type": "number", "label": "Radius", "default": 16, "min": 0, "max": 40, "step": 1 },
        "title":   { "type": "text",   "label": "Title", "default": "Hello", "maxLength": 80 }
      }
    }
    </script>

Field types: `text` (optional `maxLength`), `number` (`min`/`max`/`step`),
`boolean`, `enum` (`options: [...]`), `color` (`#rrggbb`). Every field needs a
`default`; `label` is optional but recommended. Group names (e.g. `box`) become
the collapsible sections in the editor.

Do not put a literal `</script>` inside string values, and don't repeat the
schema tag text in a comment.

### 3.2 Read the settings

At serve time the platform injects, for both the live OBS source and the editor
preview:

* `window.OVERLAY_SETTINGS` — `{ group: { key: value } }`.
* One CSS variable per field: `--ov-<group>-<key>` on `:root`
  (e.g. `--ov-box-bgColor`, `--ov-box-radius`).
* A call to `window.applySettings(settings)` on first load **and** on every
  change the user makes in the editor.

Use whichever is convenient — usually both:

**CSS variables** are perfect for colours, opacity and (via `calc`) sizes:

    #card {
      background: var(--ov-box-bgColor, #6d28d9);   /* fallback = your default */
      border-radius: calc(var(--ov-box-radius, 16) * 1px);  /* number -> px */
    }

Numbers arrive unit-less, so multiply by `1px` (or `1%`, `1deg`, …) in `calc`.

**`applySettings`** is best for text content, font mapping, layout and motion:

    window.applySettings = function (s) {
      document.getElementById('title').textContent = s.box.title;
    };

That's the whole contract. No build step, no framework, no network calls.

---

## 4. How it runs

* `view.php?t=<token>` detects a custom product and outputs your HTML with the
  settings block injected after `<head>` and a tiny adapter before `</body>`.
  The adapter applies the initial settings, relays editor changes via
  `postMessage`, and performs the editor↔preview handshake. The **same** output
  serves OBS and the dashboard preview, so what you customise is exactly what
  streams.
* The dashboard editor loads that page in its preview iframe, builds the
  controls from your schema, and saves through `save-settings.php`, which clamps
  every value against your schema (numbers to range, enums to allowed options,
  colours to `#rrggbb`, text length-limited).

## 5. Security notes

Custom overlays are **admin-only** and trusted: the uploaded HTML/JS runs as-is
on the token page. `view.php` has no user session, so overlay code cannot reach
authenticated actions. Only give the *Custom* upload ability to admins you trust,
the same as any code you deploy to the site.

---

## v2 additions — validation, schema-less, preview & versioning

The upload and paste paths now share **one validated pipeline**, so both behave
identically and report the same, specific errors.

- **Structural validation.** The embedded schema is checked field-by-field:
  known field types, a valid `default` for each field, numeric `min`/`max`
  ranges, and `options` lists for select fields. Errors name the exact field to
  fix instead of a generic "invalid schema". Use the **Validate** button on the
  product form to check HTML before saving.
- **Schema-less overlays are allowed.** HTML with **no** `overlay-schema` block
  is accepted as a valid **static** overlay: it renders exactly as written with
  no user-facing controls. (Previously this was rejected.)
- **Preview before commit.** The **Preview** action renders the candidate HTML
  (with default settings injected) so you can see it before saving.
- **One-step version history.** Every save stores the previous HTML + schema,
  a `overlay_version` counter and `overlay_updated_at`. **Restore previous**
  rolls back to the prior version safely (atomic update).
- **No silent fallback.** For a `custom` product, `view.php` never falls back to
  the chat renderer. If the stored HTML is missing it serves a small, OBS-safe
  diagnostic page instead of a broken/blank source.

These are additive: existing custom products keep working, and a product saved
before v2 simply has an empty version-history slot until its next save.
