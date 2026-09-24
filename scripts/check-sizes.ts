/**
 * Size budget + engine-leak gate — the last step of `pnpm verify`.
 *
 * Walks every page in the static export (`out/**\/*.html`), sums the gzipped
 * size of that page's first-load JS, and fails the build if:
 *
 *   1. any page's first-load JS exceeds `CORE_BUDGET_GZ_BYTES`
 *      (invariant 5, docs/ARCHITECTURE.md) — the core bundle is too big.
 *   2. any first-load chunk contains the string `localvert-engine:<id>` —
 *      an engine adapter's `marker` literal (invariant 3). Engine adapters
 *      are dynamic-imported only from inside a worker (see "Engines" in
 *      docs/ARCHITECTURE.md); if that marker shows up in a chunk a page
 *      loads up front, an engine leaked into the core bundle. Minifiers keep
 *      string literals, so grepping the built output for the marker is a
 *      reliable, mechanical check — no source maps or bundle analysis needed.
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

/** One first-load script as referenced by a page, resolved to bytes on disk. */
export interface ScriptInfo {
  /** Path relative to `out/`, e.g. "_next/static/chunks/main-app-abc123.js". */
  path: string;
  bytes: number;
  gz: number;
  hasEngineMarker: boolean;
}

export interface PageEvaluation {
  totalGz: number;
  overBudget: boolean;
  /** Paths (from `scripts`) whose content carries an engine marker. */
  leakedEngines: string[];
}

/**
 * Extracts every first-load script URL referenced by one exported page.
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
 */
export function firstLoadScripts(html: string): string[] {
  const urls = new Set<string>();

  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tag = match[1]?.toLowerCase();
    const attrs = match[2] ?? "";

    if (tag === "script") {
      const src = attr(attrs, "src");
      if (src) urls.add(src);
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
      urls.add(href);
    }
  }

  return [...urls];
}

/** Reads one HTML attribute's value out of a tag's raw attribute string. */
function attr(attrsSrc: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = re.exec(attrsSrc);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
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

  const totalGz = [...unique.values()].reduce((sum, s) => sum + s.gz, 0);
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

  function loadScript(outPath: string): ScriptInfo {
    const cached = scriptCache.get(outPath);
    if (cached) return cached;

    const fullPath = join(outDir, outPath);
    const bytes = readFileSync(fullPath);
    const content = bytes.toString("utf8");
    const hasEngineMarker = content.includes(ENGINE_MARKER_PREFIX);
    if (hasEngineMarker) {
      reportedMarkers.set(
        outPath,
        new Set(content.match(ENGINE_MARKER_RE) ?? []),
      );
    }
    const info: ScriptInfo = {
      path: outPath,
      bytes: bytes.byteLength,
      gz: gzipSize(bytes),
      hasEngineMarker,
    };
    scriptCache.set(outPath, info);
    return info;
  }

  const pageResults: PageResult[] = [];

  for (const htmlFile of htmlFiles) {
    const label = pageLabel(outDir, htmlFile);
    const html = readFileSync(htmlFile, "utf8");
    const scripts: ScriptInfo[] = [];

    for (const src of firstLoadScripts(html)) {
      const outPath = toOutPath(src);
      if (outPath === null) continue;

      if (!existsSync(join(outDir, outPath))) {
        brokenRefs.push({ page: label, src });
        continue;
      }
      scripts.push(loadScript(outPath));
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
