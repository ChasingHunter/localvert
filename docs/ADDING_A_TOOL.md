# Adding a tool

> **Status:** the registry contract described here lands in Phase 0.4
> ([ROADMAP](ROADMAP.md)). Until those files exist, treat this as the design
> being built toward. Once they do, this document is the reference and the
> code is the truth — if they disagree, fix this file.

This is the long form. If you are working through Claude Code, the
[add-converter](../.claude/skills/add-converter/SKILL.md) skill is the terse
checklist of the same process.

---

## The idea

A conversion is **data, not code**. You describe *what* the conversion is; the
build derives everything else. In the common case, adding a tool means adding
one file and running one command.

If you are writing conversion logic inside a tool file, something has gone
wrong. Logic belongs in an engine adapter. A tool file only declares intent.

## What one file gets you

Given `src/tools/image/jpg-to-png.ts`, `pnpm gen` produces:

- the route `/tools/jpg-to-png`, statically exported
- an options form rendered from the zod schema
- an entry on the `/image` category page and the homepage index
- `<title>` and meta description from `title` and `description`
- the engine preload hint and the service worker's cache list

No route file, no form component, no wiring. That is the entire reason the
registry is shaped this way.

---

## Worked example: JPG to PNG

### 1. Check it does not already exist

Search `src/tools/` for the slug and for the format pair. Two tools that
convert the same pair are a bug — the router picks the engine, so
"jpg-to-png-fast" is not a thing. If a tool already covers it, improve that
one.

### 2. Confirm an engine supports the pair

Read the capability table in [ENGINES.md](ENGINES.md). If nothing covers the
conversion, **stop**. You need [add-engine](../.claude/skills/add-engine/SKILL.md)
first — adding an engine is a much larger decision (license review, size
budget, worker wiring) and it deserves its own commit and probably its own ADR.

Never stub an engine to make a tool appear. A registry entry becomes a public
page promising a working tool.

### 3. Check both formats are registered

Every format lives in `src/lib/registry/formats.ts`:

```ts
jpg: {
  id: "jpg",
  label: "JPEG",
  ext: ["jpg", "jpeg"],
  mime: "image/jpeg",
  magic: [[0xff, 0xd8, 0xff]],   // required
},
```

**Magic bytes are not optional.** A dropped file's extension is a claim; the
first bytes are the fact. A `.png` that is really a JPEG must be detected as a
JPEG, or the engine receives something it cannot decode and the user gets a
confusing failure. Some formats need an offset or several alternatives — WebP
is `RIFF` at 0 plus `WEBP` at 8 — so `magic` is a list of patterns.

### 4. Write the tool file

```ts
// src/tools/image/jpg-to-png.ts
import { z } from "zod";
import { defineTool } from "@/lib/registry";

export default defineTool({
  slug: "jpg-to-png",
  category: "image",
  title: "JPG to PNG",
  description:
    "Convert JPG images to PNG in your browser. Files never leave your device.",

  accepts: ["jpg"],
  produces: "png",

  options: z.object({
    keepMetadata: z
      .boolean()
      .meta({ label: "Keep EXIF metadata", control: "switch" }),
  }),
  defaults: { keepMetadata: false },

  pipeline: [
    { op: "transcode", candidates: [{ engine: "canvas" }] },
  ],

  batch: true,
});
```

Field by field:

| Field | Notes |
|---|---|
| `slug` | Unique; **is** the URL. `<source>-to-<target>` for conversions, a verb for operations (`compress-image`, `merge-pdf`). Changing it later breaks links and SEO. |
| `category` | One of image, video, audio, pdf, document, archive. Drives grouping and per-category concurrency. |
| `title`, `description` | Public page copy and search results. Write for a person who typed "jpg to png" into a search engine, not for a developer reading the repo. |
| `accepts` / `produces` | `FormatId`s from the format table. |
| `options` | zod v4. `.meta({label, control, unit})` is what renders the form — no label, no control. |
| `defaults` | Must satisfy `options`. These are what runs when the user touches nothing, so pick the choice most people want. |
| `pipeline` | Ordered ops; each op lists engine candidates in preference order. |
| `batch` | Whether multiple files at once make sense. `true` routes output to the streaming ZIP sink. |

**Defaults carry product decisions.** `keepMetadata: false` strips EXIF —
including GPS coordinates — unless asked otherwise. That is a privacy stance
expressed as a default value, and it is the kind of choice worth stating in the
commit message.

### 5. Engine candidates and the router

When a conversion has more than one viable path, list candidates in preference
order with a `when` predicate. The router probes the browser at runtime and
takes the first candidate that passes:

```ts
pipeline: [
  {
    op: "transcode",
    candidates: [
      { engine: "jsquash-mt", when: (p) => p.crossOriginIsolated },
      { engine: "jsquash" },        // no predicate = always eligible
    ],
  },
],
```

The tool declares preference; the router resolves capability. Never branch on
browser features inside a tool file — that is what the probes are for, and it
keeps tools declarative.

Always end with a candidate that has no `when`, or the tool can resolve to
nothing on some browser.

### 6. Regenerate

```sh
pnpm gen
```

Rewrites `src/tools/index.ts` and `src/lib/engines/manifest.ts`. Both are
**checked in**, and CI fails if running `pnpm gen` produces a diff. Never
hand-edit them.

### 7. Tests

- **Registry test** — extend the suite if the tool exercises something new
  (a new option control, a new op, a new candidate shape).
- **Integration test** (browser mode) — run a real fixture through the real
  worker and the real engine.

Fixtures live in `e2e/fixtures/` and stay **under 50 KB**. Commit the smallest
file that genuinely exercises the format; a 1×1 pixel is fine for a transcode
and useless for testing progressive JPEG.

Assert **magic bytes and a plausible size range, never exact bytes**. Encoders
change output across versions, so an exact-byte assertion is a test that will
fail on a routine dependency bump for no real reason.

### 8. Documentation

- Add the row to [CONVERTERS.md](CONVERTERS.md).
- Tick the item in [ROADMAP.md](ROADMAP.md) **with the date**, if listed.

### 9. Verify and commit

```sh
pnpm verify   # typecheck + lint + test + build. All four green.
```

```
feat(tool): add jpg to png via canvas engine
```

One commit covering the tool file, the generated files, and the tests. A
separate `docs:` commit only if documentation changed beyond the matrix row and
the roadmap tick.

---

## Things that will fail review

- **Registering a conversion the engine cannot do**, intending to wire it up
  later. The route goes live and promises a working tool.
- **Conversion logic, format sniffing, or option coercion in a tool file.**
  Tool files describe; engines do.
- **Hand-editing generated files.** CI catches it, but only after you have
  wasted a cycle.
- **Widening a size budget or a CSP directive** to make something fit. Both are
  load-bearing. Fix the cause.
- **Exact-byte output assertions.** They rot.
- **A tool with no non-conditional engine candidate**, which silently resolves
  to nothing on browsers that fail every predicate.
