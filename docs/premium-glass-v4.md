# OverlayHub v4 — Movement Fix + Premium Shine Glass

This release changes how chat overlays move and adds a new premium template
family. It is fully backward compatible: existing overlays keep working and look
the same until you opt into a new template.

## 1. Global chat movement fix (applies to every overlay)

Chat no longer scrolls on its own. The old horizontal "conveyor/ticker" that
slid cards continuously across the screen has been removed.

New behaviour (shared movement engine, independent of the visual theme):

- **No new chat → no movement.** Cards sit perfectly still.
- **A new message arrives →** it animates in at one edge and the existing cards
  shift once to make room, then everything **stops** and stays stationary.
- Old messages are removed by **count** (Max visible), not by a timer, so nothing
  disappears just because time passed.
- Vertical mode is unchanged (it already behaved this way).

### Setting change
- **Horizontal → "Speed (px/s)"** is now **"Insertion speed (ms)"** — how fast the
  insert/shift animation plays (80–1000 ms, default 260). It no longer controls any
  idle scrolling, because there is none.
- The old **Lanes** / **Lane gap** options were removed (they only existed for the
  multi-row conveyor). Existing saved values are ignored safely.

## 2. New template presets

Open an overlay → **Customise the look** → **Template preset** and pick one:

| Preset | Look |
| --- | --- |
| **Premium Glass** | Left column of dark, frosted-glass cards with a soft continuous diagonal shine. Newest at the bottom. |
| **Purple Cosmic** | Premium Glass + special role cards (owner / VIP / super chat) use bundled cosmic nebula backgrounds and a periodic shine. |
| **Neon** | Dark glass with bright neon borders and a fast diagonal shine. |
| **Dark Glass** | Minimal frosted glass, no diagonal shine. |
| **Custom** | Your own hand-tuned settings (the default). |

Presets simply fill in the normal design settings, so after applying one you can
keep tweaking any individual control and then **Save design**. Everything is stored
per-overlay through the usual save path.

## 3. Diagonal "shine" light-sweep (new, separate effect)

Under **Customise the look → Glass Shine** you get a diagonal specular light-sweep
that glides across the cards. This is separate from the existing border *ring*
shine — you can use either, both, or neither.

**Modes**
- `off` — no sweep (default; pre-v4 overlays stay exactly as they were).
- `entrance` — one sweep when a card appears.
- `continuous` — a gentle looping sweep.
- `periodic` — a sweep every *Period* seconds.
- `special-only` — sweep only on special cards (super chat / owner / VIP / etc.).

**Controls:** color, opacity, band width (%), angle, sweep duration, period, and a
"boost special role cards" toggle that makes VIP/owner/super-chat cards shine more
often.

The sweep is purely decorative: it never moves the chat cards, and it is disabled
automatically when the viewer's system prefers reduced motion.

## 4. Special role cards

The role themes from the previous release (viewer / member / VIP / moderator /
owner / super chat) now ship with bundled cosmic backgrounds used by the
**Purple Cosmic** preset:

- `assets/img/cosmic-purple.png` (owner / VIP)
- `assets/img/cosmic-blue.png` (super chat)

You can point any role's **Background image** at your own https image instead.

## 5. Compatibility & performance notes

- Overlays saved before v4 (no Glass Shine / preset data) load unchanged; the
  diagonal shine defaults to `off`.
- `chat.php` now always returns a complete settings tree for chat overlays, so a
  freshly redeemed overlay renders correctly even before its first save.
- No idle animation loops run while chat is quiet, which keeps OBS CPU/GPU usage low.
