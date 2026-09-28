# ADR-0015: A universal "From â†’ To" converter over the registry

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

Localvert has 123 tools. Counted from `src/tools/**` on 2026-09-28: 102
distinct format-change pairs across 46 input formats, plus 54 same-format
actions (compress, resize, rotate, crop, trim, merge, watermark, OCRâ€¦). The
home page lists tools as category card grids, capped at six per category. The
owner's problem: people can't find the right converter in that many cards.

Two ways in are wanted:

1. **From â†’ To pickers.** "I have a PDF and want Word": pick both, go.
2. **Drop any file.** The format is detected, and the valid outputs appear.

UX and accessibility are the priority. The full visual redesign comes later in
v0.4.0; this ADR covers interaction, not look.

A research pass over CloudConvert, Convertio, FreeConvert, Zamzar, iLovePDF,
Smallpdf, 123apps, Online-Convert, VERT and Squoosh agreed on a few points:

- Generate the output list from real capability.
- Filter it by the input.
- Keep option panels collapsed.

The failures were one giant alphabetical `<select>` (Zamzar), tile grids that
stop scaling past about 20 tools (iLovePDF), page loads between steps
(Online-Convert), and ads inside the flow.

## Decision

Build one **Converter** client island. It holds the only state that matters:
`{ from?: FormatId, target?: Target, files?: File[] }`. Both entry flows fill
that state, and neither is a separate mode.

**Data: a generated catalog, not the registry.** `pnpm gen` also writes
`src/tools/catalog.ts`. It is plain serialisable data with one row per tool:
`{ slug, title, category, accepts, produces, kind, arity, keywords, rank }`.
The picker never imports `TOOLS`, because TOOLS carries every tool's zod
schema and pipeline, which the home page must not pay for. The helpers are
pure and unit-tested:

- `inputFormats()`: the formats that at least one tool accepts, grouped by
  category.
- `targetsFor(from)`: the format targets for that input, then the same-format
  actions for it.

The picker is a view over the registry, so an impossible pair can't be offered.

**Targets.** A target is either a *format*, such as "Word (.docx)", or an
*action*, such as "Compress" or "Rotate". Actions appear in the same To list
under their own "Actions" group, so there's no second mental model for "not
really a conversion".

When several tools produce the same pair (6 today), the target resolves to
one **default** tool by rank: the exact per-pair page first. The others appear
as labelled variants.

- JPG â†’ PDF gives "PDF" (jpg-to-pdf) and "Searchable PDF (OCR)".
- MP4 â†’ MP3 prefers mp4-to-mp3 over extract-audio.

**Formats get human names and aliases.** `FormatSpec` gains `aliases`, and
typing any of them filters to the right format:

- "jpeg" finds JPG.
- "word" finds DOCX/DOC.
- "excel" finds XLSX/XLS.
- "iphone photo" finds HEIC.
- "camera raw" finds RAW.

The To list's filter also matches action names, so typing "compress" works
from both pickers' perspective.

**Flow.**

1. Pick From, then To. **Go** navigates client-side to the chosen tool's
   existing page, `/tools/<slug>`. The pair pages stay the single place a
   conversion runs, and they stay crawlable and shareable. There is no
   second runner UI.
2. Drop, paste or browse files onto the Converter. The existing
   sniff + `refineFormat` logic (`dropzone-logic.ts`) detects the format and
   fills From. Focus moves to To, which is already filtered.
   - Choosing a target navigates the same way, and the files come along
     through an in-memory handoff: a module-level store read by the tool
     page's dropzone on mount. The files are never serialised and never
     leave the tab.
   - If the files are of mixed formats, they're grouped by format and the
     user picks the group to convert. v1 converts one group at a time.
   - Undetectable files get an explicit message, never a silent no-op.
3. **Popular** chips under the pickers, such as PDF â†’ Word, JPG â†’ PNG,
   MP4 â†’ MP3 and Compress PDF, come from `rank` in the catalog. They're
   plain links, so they work before hydration.

**Accessibility contract (non-negotiable, tested):**

- **The pickers are APG "editable combobox with listbox popup".**
  - Roles and state: `role="combobox"` on the input, with `aria-expanded`
    and `aria-controls`; the popup is a `listbox` of `option`s.
  - Focus: DOM focus stays on the input, and `aria-activedescendant` tracks
    the highlighted option.
  - Grouping: groups use `role="group"` labelled by a non-option heading.
- **Keyboard:**
  - â†“/â†‘ open the list and move through it.
  - Home/End jump to the first and last option.
  - Enter commits the highlighted option.
  - Esc closes the list and then clears it.
  - Tab commits and moves on. It never traps focus.
  - The whole flow works with the keyboard alone: drop zone (Enter or Space
    opens the file browser) â†’ From â†’ To â†’ Go.
- **One polite live region** announces:
  - detection: "Detected report.pdf â€” PDF document, 1.2 MB. 14 options
    available."
  - count changes: "5 results".
  - errors, with the specific reason.
- **Focus management:** after a drop, focus moves to To. After Go, the tool
  page's heading receives focus.
- **Sizing and motion:** targets are at least 44Ã—44 px on touch. Decorative
  motion is disabled under `prefers-reduced-motion`. Contrast meets WCAG AA.
- **Without JavaScript:** the server-rendered category lists and Popular
  links remain, so the page never depends on the island.
- **Automated checks:** `@axe-core/playwright` (dev dependency, MPL-2.0,
  test-only) runs on the home, category and tool pages in e2e. Zero serious
  or critical violations is a CI gate.

**Where it lives.**

- **Home:** the hero is the Converter, replacing today's "how it works" block.
- **Category pages:** the same island, pre-filtered to that category's
  formats.
- **Tool pages:** a small "Convert something else" link back to it.
- **Budget:** the island must add no more than 15 KB gz to the home page's
  first load. Today the home page is 134 KB and the budget is 300 KB.

## Consequences

- Discovery becomes two picks or one drop, whatever the tool count.
- New tools appear in the pickers automatically on `pnpm gen`.
- Pair pages stay the canonical runner, so SEO, sharing and the back button
  keep working.
- **Cost:**
  - A hand-rolled accessible combobox. No UI library in the stack has one we
    want to ship, so we own the keyboard contract and must test it.
  - `aliases` and `rank` become data every new format and tool should fill.
  - The in-memory file handoff only survives client-side navigation. A hard
    reload of the tool page drops the files. That's acceptable: the user just
    drops them again.
- Multi-hop conversions (for example HEIC â†’ WebP, which no single tool does)
  are out of scope. The To list only offers what one tool can do. Chaining is
  a possible later ADR.

## Alternatives considered

- **Native `<select>` for both pickers.** It has free keyboard and mobile
  support, but no type-to-filter, no alias search and no rich group
  labelling. 46 inputs, and up to about 20 targets for common image inputs,
  need search.
- **Inline runner on the home page** (convert without navigating). Rejected
  for v1: it duplicates the tool page's runner, options and consent flow, and
  splits the canonical URL. It can be revisited in the redesign.
- **Search box only ("What do you want to do?").** Good for actions, weak for
  "I have a HEIC", which is the owner's core case. The pickers' filters cover
  search anyway.
- **Full-page step navigation (Online-Convert style).** Two page loads before
  anything happens. Rejected.
