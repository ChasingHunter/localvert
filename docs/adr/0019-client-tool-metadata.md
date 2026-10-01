# ADR-0019: Plain-data tool metadata for the main thread

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Every tool file imports zod for its options schema, and `ToolRunner` loaded the
tool file on every tool page. Zod is a ~391 KB raw / ~92 KB gz chunk. It was
fetched and evaluated on the main thread right after hydration: about 300 ms of
long tasks under Lighthouse's 4x mobile throttle. Measured 2026-10-01, mobile
performance on tool pages was 90 (compress-jpg), 93 (word-to-pdf) and 92
(pdf-editor), against 100 on desktop. The roadmap target is 95+.

Nothing on the main thread needs zod's validation engine. It needs the form's
field list, the defaults, which engines the pipeline names, and a few flags.

## Decision

The main thread works from plain data derived from the tools. Zod stays the
source of truth in `src/tools/**`, and tool files keep their shape.

- **The contract.** `ClientTool` (`src/lib/registry/client-tool.ts`) is
  serialisable data: option field descriptors (what `describeFields` returns,
  plus `integer`, `exclusiveMin` and `optional` flags on number fields),
  defaults, pipeline steps with engine ids, accepts/produces/arity,
  `actionLabel`, `rangeStage`, `estimateKind`, `neverLarger`, `readiness` and
  the output-name rule. `toClientTool` (`src/tools/client-tool.ts`) builds it
  from a `ToolDefinition`.
- **Where it is built.** The tool page is a server component, so it calls
  `toClientTool(tool)` while the site is exported (zod runs there, at build
  time) and passes the result to `ToolRunner` as a prop. `ToolRunner` and
  `OptionsForm` read only that. App tools (the PDF editor) don't use it.
- **Things that were functions are now data.** `readiness` is a
  `ReadinessRule` (`{ anyPositive, onlyWhen, hint }`) run by `isReady`.
  `outputName` is derived by `toClientTool` into `outputExtFromOption` (keep
  the basename, take the extension from one select option), which covers the
  only tool that has one, `extract-audio`. Pipeline candidates can't carry a
  `when` predicate for the client; none do today, and `toClientTool` throws if
  one appears. `defineTool` no longer computes `requiredOptionKeys`,
  `requiredOptionShowWhen` or `hasFormFields`; the UI derives them from the
  descriptors.
- **Where validation happens.** The form checks what a descriptor can express
  (`validateFields`: a number's type, int, min, max), with the same wording
  zod uses. The authoritative parse moves into the worker: the job engine sends
  the raw form values and the tool slug, and `engine.worker.ts` imports the
  real tool, runs `options.parse` and hands the parsed object to the engines
  (`src/lib/workers/tool-options.ts`). A value the schema rejects fails that
  job with an error card instead of throwing from `submit`. The job engine,
  naming and consent gate work from `JobTool`-shaped data and no longer import
  the registry barrel.
- **Only describable checks are allowed.** `describeFields` throws if a string,
  enum or boolean option carries a zod check, or a number carries anything but
  int/min/max, because the form couldn't run it. Put that check in the engine.
- **Drift is prevented by tests, not discipline.**
  `src/tools/client-tool.test.ts` runs `toClientTool` over every tool: the
  output must be plain JSON-safe data, its descriptors must equal
  `describeFields`, output names must match the tool's own `outputName`, and
  `validateFields` must give zod's message for every number field.
  `src/lib/options/no-zod-on-main.test.ts` walks the import graph from the
  main-thread entry points and fails if zod, a tool module, `defineTool` or the
  registry barrel becomes reachable. `check-sizes` fails if zod's class-name
  literal appears in a first-load chunk.

## Consequences

- Tool pages stop fetching and evaluating zod on the main thread, and no longer
  fetch a per-tool chunk after hydration at all: the tool's data is in the page.
  The "Loading converter" placeholder and its slow-load fallback are gone,
  since there is nothing left to load. The tool's data adds a few KB to each
  page's HTML (compressed on the wire), and 123 tool-loader entries leave the
  first-load JS.
- Measured on 2026-10-02: tool-page first-load JS went from 165.0 KB to
  161.2 KB gz, and Lighthouse mobile total blocking time on compress-jpg,
  word-to-pdf and trim-video fell from about 290, 230 and 440 ms to about 170,
  70 and 190 ms. Mobile scores moved from 83-91 to 92-94 (runs vary by about
  5 points). What is left under 95 is framework and page-chunk evaluation
  (React and Next are about 1 s of script at the 4x throttle), not zod. The
  PDF editor page never loaded zod, so this does not change it.
- Zod now loads in the worker, once per worker, on its first job.
- Adding a tool is unchanged: write the tool file, run `pnpm gen`. A tool
  `toClientTool` can't express as data fails `pnpm check` (the registry test)
  and `next build`, naming the tool and the reason.
- An out-of-range value that gets past the form (it can't, in practice) is
  reported on the job card after submit, not as a thrown error.
- `ToolRunner` is now server-rendered with its real content instead of a
  placeholder. Everything it renders before hydration is the same markup the
  client renders, because its initial state comes from the same data.

## Alternatives considered

- **Generate one JSON file per tool at `pnpm gen` time and load it lazily.**
  Built and measured first. It works, but adds 123 committed files, a second
  generator that has to evaluate tools under Node with a custom module
  resolver, a loader map and a loading state, and it grew first-load JS by
  about 0.05 KB (the loader map and the shared helpers outweighed what left).
  Passing the same data as a prop from the server page is the same contract
  with none of that machinery, and first-load JS drops by 3.8 KB.
- **Load the full tool lazily at submit time.** Cheap, and it would clear the
  Lighthouse run (nothing is submitted), but zod would still run on the main
  thread for every real user's first conversion. Rejected.
- **Hand-write the descriptors in each tool file.** Two sources of truth that
  drift. Rejected for the same reason the catalog is generated.
