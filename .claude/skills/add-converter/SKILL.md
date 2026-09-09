---
name: add-converter
description: Add a new file conversion to Localvert — registry entry, tests, docs, and commit. Use when asked to add or support a conversion (e.g. "add heic to jpg", "support webp output", "add an image resize tool").
---

# Add a converter

A conversion is **data, not code**. In the common case you add exactly one file
to `src/tools/<category>/` and run `pnpm gen`; the route, options form,
category listing and SEO metadata all derive from it. If you find yourself
writing conversion logic inside a tool file, stop — that belongs in an engine
adapter, and the tool file should only describe *what* to do.

## Steps

1. **Check it does not already exist.** Search `src/tools/` for the slug and
   for the input/output format pair. If a tool already covers it, stop and say
   so rather than adding a near-duplicate.

2. **Confirm an engine supports the pair.** Read the capability table in
   `docs/ENGINES.md`. If no engine covers this conversion, **stop**: tell the
   user it needs the `add-engine` skill first and which engine you would
   recommend. Never stub a fake engine to make a tool appear.

3. **Check both formats exist** in `src/lib/registry/formats.ts` with
   extension, MIME type and magic bytes. Add the format there first if it is
   new. Magic bytes are required — sniffing content is how a dropped file gets
   validated, because a file extension is a claim, not a fact.

4. **Write `src/tools/<category>/<slug>.ts`**, following the neighbouring files
   exactly. Slug is `<source>-to-<target>` for conversions (`heic-to-jpg`) or a
   verb for operations (`compress-image`, `merge-pdf`). `title` and
   `description` are the public page's copy and SEO text — write them for a
   person searching the web, not for a developer reading the repo.

5. **`pnpm gen`** to regenerate `src/tools/index.ts` and the engine manifest.
   Never hand-edit generated files; CI fails if they drift from the sources.

6. **Tests.** Extend the registry suite if the tool exercises something new,
   and add an integration case that runs a real fixture through the pipeline.
   Fixtures live in `e2e/fixtures/` and stay under 50 KB — commit the smallest
   file that genuinely exercises the format. Assert output magic bytes and a
   plausible size range, never exact bytes: encoders drift between versions and
   exact-byte assertions rot into false failures.

7. **Docs.** Add the row to `docs/CONVERTERS.md`, and tick the item in
   `docs/ROADMAP.md` with today's date if it is listed there.

8. **`pnpm verify`** — all four gates green.

9. **Commit** `feat(tool): add <source> to <target>`, covering the tool file,
   generated files and tests. A separate `docs:` commit only if documentation
   changed beyond the matrix row and the roadmap tick.

## Do not

- Register a conversion the engine cannot actually perform "to be wired up
  later". A registry entry becomes a public page promising a working tool.
- Put conversion logic, format sniffing, or option coercion in a tool file.
- Widen a size budget or a CSP directive to make something fit.
