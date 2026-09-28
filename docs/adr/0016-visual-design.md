# ADR-0016: Visual design: calm, warm, a little playful, privacy first

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

v0.4.0 redesigns the site. The owner's brief (2026-09-28):

- A modern look. Calm, but a bit playful.
- Privacy first.
- A warm, human feel in the spirit of Claude's own site.
- A sentence-style hero converter.
- Auto light/dark with a manual toggle.
- Copy that doesn't read as AI-generated.

UX and accessibility stay the top priority. ADR-0015 already fixed the
interaction; this ADR sets the look.

**What exists today:**

- 7 colour tokens in `src/app/globals.css`: neutral grey-blue with one blue
  accent.
- System fonts.
- A centred column of identical rounded cards.
- No logo.

It's clean but anonymous. Nothing says "your files stay on your device".

**Constraints:**

- **CSP** `font-src 'self'`, so fonts are self-hosted from
  `@fontsource-variable`. Fraunces and Figtree are both OFL-1.1.
- **The 300 KB JS budget.** Fonts and CSS don't count against it, but keep
  them lean. Load the Latin subsets only.
- **The e2e axe gate:** WCAG 2.2 AA must stay green.

## Decision

**Direction: "warm paper, clear ink".** A soft oat paper background, a deep
sea-green accent (calm, reads "safe", and deliberately not Claude's
terracotta) and a friendly serif for display.

**Where the playfulness lives:**

1. Each category has its own soft colour, carried by its format chips.
2. The display serif's soft, slightly wonky letterforms.
3. The sentence converter's format words, which swap with a short
   motion when you pick one.

The rest stays quiet.

### Tokens (replace the `@theme` block)

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#F7F6F2` | `#1B1A18` | page background (oat / warm night) |
| `surface` | `#FFFFFF` | `#24231F` | inputs, panels, popovers |
| `border` | `#E2DED5` | `#3A3832` | hairlines, input borders |
| `ink` | `#23211E` | `#EEEBE4` | text |
| `ink-muted` | `#67625A` | `#A8A298` | secondary text (≥ 4.5:1 on canvas) |
| `accent` | `#2D6A58` | `#7FC6B0` | links, primary buttons, focus ring |
| `accent-soft` | `#DDEBE5` | `#23392F` | selected / active backgrounds |
| `danger` | `#B3362B` | `#F08A7E` | errors |

**Category tints.** Each is a background tint with `ink` text on it; text
never goes in the tint colour itself.

| Category | Light | Dark |
|---|---|---|
| image | `#F7DDD6` | `#4A302B` |
| video | `#E3DEF6` | `#353050` |
| audio | `#F4E7BE` | `#4A4128` |
| pdf | `#D7E6F4` | `#26394B` |
| document | `#DAEDE0` | `#27402F` |
| data | `#ECE3D2` | `#403829` |

The implementer must verify every text/background pair at WCAG AA (4.5:1
body, 3:1 large text and UI) and nudge the lightness if needed. Don't change
the hues.

**Theme:**

- Light and dark follow `prefers-color-scheme` by default.
- A header toggle cycles through System → Light → Dark. It sets
  `data-theme` on `<html>` and remembers the choice in `localStorage`
  (a convenience only, wrapped in try/catch).
- A tiny inline script in `<head>` applies the stored choice before first
  paint, so there's no flash. Its hash must go through the existing
  `scripts/csp-inline-hashes.ts` path.

### Type

**Display: Fraunces (variable).**

- Axes: `opsz` auto, `SOFT` about 50, `WONK` 1.
- Weights: 500 for headings, 600 for the hero.
- Use: the hero sentence, page titles (h1), category headings and the
  wordmark. Nowhere else.

**Text: Figtree (variable).** Weights 400/500/600 for everything else: body,
UI, labels, buttons and inputs.

**Scale** (1.25 ratio, 16 px base):

- Sizes: 13 · 14 · 16 · 20 · 25 · 31 · 39 · 49.
- Hero: `clamp(2.25rem, 5vw, 3.5rem)`, line-height 1.1.
- Body: 16/1.6.
- Measure: ≤ 68ch.

**No all-caps labels. No tracked-out eyebrows. No mono for data labels.**

### Layout and shapes

**Alignment and grid.** Left-aligned, never centre-stacked. Content max
width is 72rem with a generous gutter (24 px on mobile, 48 px on desktop).

**Home:**

```
Localvert                                   Images Video Audio PDF … [◐]
────────────────────────────────────────────────────────────────────────
Convert my  [ PDF ▾ ]  into  [ Word ▾ ]   (Convert)
            ↑ Fraunces hero; pickers are inline pills in the sentence

Your files stay on this device. Nothing is uploaded.   How we know
┌ drop area (dashed, calm) ────────────────────────────────────────────┐
│  Or drop a file here and we'll work out what it is.   Choose files   │
└──────────────────────────────────────────────────────────────────────┘
Popular   [PDF → Word] [JPG → PNG] [MP4 → MP3] [Compress PDF] …  (tinted chips)

Images                                         (Fraunces h2, tint dot)
JPG to PNG · PNG to JPG · HEIC to JPG · …      (link list, not cards)
Video …
```

Category sections become **link lists** in a responsive multi-column flow,
not card grids. There are 120+ tools, and scannable text beats boxes. The
exception is the one-line description on each category page, which stays.

**Tool pages.** A Fraunces h1, then a one-sentence plain description. The
drop area is the main panel, with options in a quiet side column on desktop
and stacked below on mobile. Job rows are simple lines, not heavy cards.
"Convert something else" sits near the top.

**Radius hierarchy:**

- Pills (pickers, chips, buttons): full.
- Panels (drop area, popovers): 16 px.
- Small UI: 8 px.

Minimal shadows: only popovers get a soft shadow. Surfaces separate by
hairline and tint.

**Motion.** One moment: in the hero sentence, a changed format word
cross-fades and slides about 4 px (≤ 180 ms). Everything else only answers
the user: open, close, press. All of it is off under `prefers-reduced-motion`.

**Focus.** A 2 px `accent` ring with a 2 px offset on every interactive
element. Never removed.

### Copy voice (applies to every string the redesign touches)

- Write like a person explaining to a friend: short, plain, specific.
- **Few em dashes.** Prefer a full stop or a comma.
- No hype words: seamless, effortless, powerful, unlock, supercharge,
  empower, magic, blazing.
- Say what happens. Button labels are actions ("Convert", "Download",
  "Choose files"), and the result keeps the same word ("Converted").
- Privacy stated as fact, not as a slogan: "Your files stay on this device.
  Nothing is uploaded." "How we know" links to a short explanation of the
  CSP (`connect-src 'self'`).
- Errors say what went wrong and what to do. No apologies, no "Oops".
- Sentence case everywhere.

## Consequences

- **The site gets a recognisable identity:** the serif hero sentence plus
  the category tints. Privacy becomes the first thing you read.
- **Cost:**
  - About 60–90 KB of woff2 fonts, cached after the first visit.
  - A theme script in `<head>`.
  - Every component's classes get touched once.
- Link lists instead of card grids lose per-tool descriptions on the home
  page. Category and tool pages keep them.

## Alternatives considered

- **Claude's exact palette** (cream `#F4F1EA`, terracotta `#D97757`) with a
  high-contrast serif: the owner likes the vibe, but copying it would read
  as an Anthropic product and as the default AI-generated look. We keep the
  warmth and pick our own accent.
- **System fonts only:** zero bytes, but the identity would rest entirely on
  colour, and the owner was fine either way.
- **Keeping card grids:** they don't scale to 120+ tools and are the most
  generic layout there is.
