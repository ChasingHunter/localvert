/**
 * Size budget + engine-leak gate — the last step of `pnpm verify`.
 *
 * Walks every page in the static export (`out/**\/*.html`), sums the gzipped
 * size of that page's first-load JS, and fails the build if:
 *
 *   1. any page's first-load JS exceeds `CORE_BUDGET_GZ_BYTES`
 *      (invariant 5, docs/ARCHITECTURE.md) — the core bundle is too big.
 *      `<script nomodule>` chunks are excluded from this sum (see
 *      `firstLoadScripts` and `evaluatePage`): they're Next's legacy bundle
 *      for browsers with no ES module support, and Localvert requires a
 *      module-capable browser anyway (workers, wasm, ES modules), so no
 *      browser it supports ever fetches one.
 *   2. any first-load chunk contains one of `FORBIDDEN_FIRST_LOAD_SUBSTRINGS`:
 *      either the string `localvert-engine:<id>` — an engine adapter's
 *      `marker` literal (invariant 3), or the literal `@embedpdf` — the PDF
 *      editor's session engine (ADR-0009), whose packages ship module-path
 *      and CDN-URL string literals that survive minification. Engine
 *      adapters and the editor's `@embedpdf/*` code are dynamic-imported only
 *      from inside a worker or an app-mode tool's own lazily-loaded chunk
 *      (see "Engines" in docs/ARCHITECTURE.md); if either marker shows up in
 *      a chunk a page loads up front, something heavy leaked into the core
 *      bundle. The literal `$ZodType` (zod itself, ADR-0019) is the same kind
 *      of marker: zod belongs in the worker, not in any first-load chunk. Minifiers keep string literals, so grepping the built output
 *      for these markers is a reliable, mechanical check — no source maps or
 *      bundle analysis needed.
 *   3. a page references a script file that isn't in `out/` — broken build
 *      output.
 *
 * Runs as plain `node scripts/check-sizes.ts` (Node 22's built-in TypeScript
 * type stripping — no build step for this script itself). Keep it to
 * erasable syntax only: no enums, no namespaces, no parameter properties.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * Invariant 5 (docs/ARCHITECTURE.md): core first-load JS stays under 300 KB
 * gzipped, so the app shell loads fast on a phone before any engine is
 * fetched. Never raise this to make a build pass — CLAUDE.md is explicit
 * that a budget gets widened only by fixing the cause, not the number.
 */
export const CORE_BUDGET_GZ_BYTES = 300 * 1024;

/**
 * Every engine adapter module contains the string literal
 * `localvert-engine:<id>` in its `marker` field (see docs/ARCHITECTURE.md,
 * "Engines"). Its presence in a first-load chunk means an engine landed in
 * the core bundle instead of being dynamic-imported from a worker.
 */
const ENGINE_MARKER_PREFIX = "localvert-engine:";
const ENGINE_MARKER_RE = /localvert-engine:[\w-]+/g;

/**
 * A first-load chunk containing any of these substrings is a build-time
 * failure (see the module doc comment's point 2). `@embedpdf` is not a
 * `marker`-shaped literal like an engine adapter's — it's the npm scope of
 * every PDF editor package (ADR-0009) — so it's matched as a plain substring
 * rather than through `ENGINE_MARKER_RE`.
 */
const FORBIDDEN_FIRST_LOAD_SUBSTRINGS = [
  ENGINE_MARKER_PREFIX,
  "@embedpdf",
  // zod's own class-name literal. It must not run on the main thread
  // (ADR-0019): the tool page works from generated plain data, and only the
  // job worker imports the tool modules. A first-load chunk carrying this
  // means a component statically imported a tool or `defineTool` again.
  "$ZodType",
] as const;

/**
 * Every forbidden substring found in `content`, for reporting which page and
 * which chunk leaked what. Returns `localvert-engine:<id>` markers verbatim
 * (one per distinct engine id) and, separately, the literal `"@embedpdf"`
 * when any `@embedpdf/*` package code is present.
 */
export function findForbiddenMarkers(content: string): string[] {
  const found: string[] = [];
  for (const substring of FORBIDDEN_FIRST_LOAD_SUBSTRINGS) {
    if (!content.includes(substring)) continue;
    if (substring === ENGINE_MARKER_PREFIX) {
      found.push(...(content.match(ENGINE_MARKER_RE) ?? []));
    } else {
      found.push(substring);
    }
  }
  return found;
}

/** One first-load script as referenced by a page, resolved to bytes on disk. */
export interface ScriptInfo {
  /** Path relative to `out/`, e.g. "_next/static/chunks/main-app-abc123.js". */
  path: string;
  bytes: number;
  gz: number;
  hasEngineMarker: boolean;
  /**
   * True for a legacy `<script nomodule>` chunk. Excluded from the budget
   * sum in `evaluatePage` (see the module doc comment above), but still
   * loaded and scanned like any other script — a leaked engine marker in a
   * nomodule chunk is still a leak.
   */
  noModule: boolean;
}

/** One script or preload reference found in a page's HTML, before it's resolved to a file. */
export interface ScriptRef {
  /** URL from a `src`/`href` attribute, exactly as it appears in the HTML. */
  src: string;
  /** True if the reference came from a `<script nomodule src="...">` tag. */
  noModule: boolean;
}

export interface PageEvaluation {
  totalGz: number;
  overBudget: boolean;
  /** Paths (from `scripts`) whose content carries an engine marker. */
  leakedEngines: string[];
}

/**
 * Extracts every first-load script reference from one exported page.
 *
 * Next's static export (checked against a real `out/index.html` build,
 * Next 16) lists a page's first-load JS two ways:
 *
 *   - `<script src="...">` tags — the chunks the browser actually executes
 *     before the page hydrates (webpack runtime, framework, the page's own
 *     entry). These carry `async`/`crossorigin` attributes but always a
 *     `src`.
 *   - `<link rel="preload" as="script" href="...">` tags in `<head>` — chunks
 *     Next warms the fetch for ahead of the matching `<script src>` tag. Not
 *     `rel="modulepreload"`: the export ships classic scripts, not ES
 *     modules, so there's no `modulepreload` link to find. We still check
 *     for one (belt and suspenders against a future Next version that
 *     switches to ESM chunks) so this function keeps working either way.
 *
 * Inline `<script>` tags with no `src` (the RSC flight payload Next streams
 * as `self.__next_f.push(...)`) carry no separate bytes to budget and are
 * ignored.
 *
 * A `<script src>` tag also carries a `noModule` flag when it has a
 * `nomodule` attribute — Next's legacy, pre-ES-module bundle for browsers
 * without `<script type="module">` support. It's still returned (its bytes
 * still need scanning for a leaked engine marker) but flagged so
 * `evaluatePage` can leave it out of the budget sum: no browser Localvert
 * supports is module-incapable, so none of them ever fetch it.
 */
export function firstLoadScripts(html: string): ScriptRef[] {
  const noModuleByUrl = new Map<string, boolean>();

  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tag = match[1]?.toLowerCase();
    const attrs = match[2] ?? "";

    if (tag === "script") {
      const src = attr(attrs, "src");
      if (src) {
        const noModule =
          hasAttr(attrs, "nomodule") || (noModuleByUrl.get(src) ?? false);
        noModuleByUrl.set(src, noModule);
      }
      continue;
    }

    // tag === "link"
    const rel = attr(attrs, "rel");
    const href = attr(attrs, "href");
    if (
      href &&
      (rel === "modulepreload" ||
        (rel === "preload" && attr(attrs, "as") === "script"))
    ) {
      if (!noModuleByUrl.has(href)) noModuleByUrl.set(href, false);
    }
  }

  return [...noModuleByUrl].map(([src, noModule]) => ({ src, noModule }));
}

/** Reads one HTML attribute's value out of a tag's raw attribute string. */
function attr(attrsSrc: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = re.exec(attrsSrc);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/** True if a boolean attribute (e.g. `nomodule`) is present, with or without a value. */
function hasAttr(attrsSrc: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(attrsSrc);
}

/** `node:zlib` gzip at max compression — matches what a real HTTP server ships. */
export function gzipSize(buf: Uint8Array): number {
  return gzipSync(buf, { level: 9 }).length;
}

/**
 * Sums one page's unique first-load scripts against the budget. `scripts`
 * may list the same `path` more than once (e.g. a chunk referenced by both a
 * preload link and a script tag) — those are deduplicated so the page's
 * total counts each script's bytes once.
 *
 * A `noModule` script is excluded from `totalGz` — no module-capable browser
 * (every browser Localvert supports) ever fetches one — but it's still
 * eligible for `leakedEngines`, same as any other script.
 */
export function evaluatePage(
  // Prefixed `_`: names the page for callers and error messages, but the
  // evaluation itself only depends on `scripts`.
  _page: string,
  scripts: readonly ScriptInfo[],
  budgetBytes: number,
): PageEvaluation {
  const unique = new Map<string, ScriptInfo>();
  for (const script of scripts) {
    const existing = unique.get(script.path);
    if (!existing) {
      unique.set(script.path, script);
    } else if (script.hasEngineMarker && !existing.hasEngineMarker) {
      unique.set(script.path, { ...existing, hasEngineMarker: true });
    }
  }

  const totalGz = [...unique.values()]
    .filter((s) => !s.noModule)
    .reduce((sum, s) => sum + s.gz, 0);
  const leakedEngines = [...unique.values()]
    .filter((s) => s.hasEngineMarker)
    .map((s) => s.path);

  return { totalGz, overBudget: totalGz > budgetBytes, leakedEngines };
}

// ---------------------------------------------------------------------------
// main — only runs against a real `out/`, not exercised by unit tests.
// ---------------------------------------------------------------------------

interface PageResult {
  label: string;
  evaluation: PageEvaluation;
}

function findHtmlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

/** `out/foo/index.html` -> "/foo", `out/index.html` -> "/". */
function pageLabel(outDir: string, htmlFile: string): string {
  const rel = relative(outDir, htmlFile).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html"))
    return `/${rel.slice(0, -"index.html".length - 1)}`;
  return `/${rel}`;
}

/** Strips a script URL down to a path resolvable under `out/`, or null if it isn't a local file reference. */
function toOutPath(src: string): string | null {
  if (/^([a-z]+:)?\/\//i.test(src)) return null; // absolute/external URL — not part of this build.
  const withoutHash = src.split("#")[0] ?? src;
  const withoutQuery = withoutHash.split("?")[0] ?? withoutHash;
  return withoutQuery.replace(/^\/+/, "");
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function main(): void {
  const outDir = join(process.cwd(), "out");
  if (!existsSync(outDir)) {
    console.error(
      "check-sizes: out/ not found — run `pnpm build` first (check-sizes inspects the static export).",
    );
    process.exit(1);
  }

  const htmlFiles = findHtmlFiles(outDir);

  // Cache one ScriptInfo per resolved path so a chunk shared across many
  // pages (webpack runtime, framework) is only read and gzipped once.
  const scriptCache = new Map<string, ScriptInfo>();
  const brokenRefs: { page: string; src: string }[] = [];
  const reportedMarkers = new Map<string, Set<string>>(); // out-path -> marker ids found in it.

  function loadScript(outPath: string, noModule: boolean): ScriptInfo {
    const cached = scriptCache.get(outPath);
    if (cached) return cached;

    const fullPath = join(outDir, outPath);
    const bytes = readFileSync(fullPath);
    const content = bytes.toString("utf8");
    const markers = findForbiddenMarkers(content);
    const hasEngineMarker = markers.length > 0;
    if (hasEngineMarker) {
      reportedMarkers.set(outPath, new Set(markers));
    }
    const info: ScriptInfo = {
      path: outPath,
      bytes: bytes.byteLength,
      gz: gzipSize(bytes),
      hasEngineMarker,
      noModule,
    };
    scriptCache.set(outPath, info);
    return info;
  }

  const pageResults: PageResult[] = [];

  for (const htmlFile of htmlFiles) {
    const label = pageLabel(outDir, htmlFile);
    const html = readFileSync(htmlFile, "utf8");
    const scripts: ScriptInfo[] = [];

    for (const { src, noModule } of firstLoadScripts(html)) {
      const outPath = toOutPath(src);
      if (outPath === null) continue;

      if (!existsSync(join(outDir, outPath))) {
        brokenRefs.push({ page: label, src });
        continue;
      }
      scripts.push(loadScript(outPath, noModule));
    }

    pageResults.push({
      label,
      evaluation: evaluatePage(label, scripts, CORE_BUDGET_GZ_BYTES),
    });
  }

  pageResults.sort((a, b) => b.evaluation.totalGz - a.evaluation.totalGz);

  const pageCol = Math.max(4, ...pageResults.map((r) => r.label.length));
  // biome-ignore lint/suspicious/noConsole: this is the report table, stdout is the product here.
  console.log(`${"Page".padEnd(pageCol)}  ${"KB gz".padStart(9)}  % of budget`);
  for (const { label, evaluation } of pageResults) {
    const pct = Math.round((evaluation.totalGz / CORE_BUDGET_GZ_BYTES) * 100);
    const flag = evaluation.overBudget ? "  OVER BUDGET" : "";
    // biome-ignore lint/suspicious/noConsole: this is the report table, stdout is the product here.
    console.log(
      `${label.padEnd(pageCol)}  ${formatKb(evaluation.totalGz).padStart(9)}  ${`${pct}%`.padStart(4)}${flag}`,
    );
  }

  let failed = false;

  for (const { label, evaluation } of pageResults) {
    if (evaluation.overBudget) {
      failed = true;
      console.error(
        `check-sizes: ${label} is ${formatKb(evaluation.totalGz)} gz, over the ${formatKb(CORE_BUDGET_GZ_BYTES)} budget.`,
      );
    }
    for (const path of evaluation.leakedEngines) {
      failed = true;
      const markers = [...(reportedMarkers.get(path) ?? [])].join(", ");
      console.error(
        `check-sizes: engine leaked into core bundle on ${label}: ${path} (${markers})`,
      );
    }
  }

  for (const { page, src } of brokenRefs) {
    failed = true;
    console.error(
      `check-sizes: ${page} references "${src}", which is missing from out/.`,
    );
  }

  if (failed) process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
