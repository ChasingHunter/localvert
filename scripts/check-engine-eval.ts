/**
 * Engine eval guard: part of `pnpm verify`, run after the build.
 *
 * The production CSP has no `unsafe-eval`, so any engine JS that calls
 * `new Function(...)` or `eval(...)` throws an EvalError in the browser.
 * Vitest browser mode runs without that CSP, so adapter tests can't see it
 * (HEIC and RAW shipped broken this way). This scans every `.js`/`.mjs` under
 * `out/engines/` and `out/_next/static/` (heic-to is bundled there, not
 * shipped as an engine asset) for those two calls and fails the build on a
 * hit.
 *
 * Runs as plain `node scripts/check-engine-eval.ts`: erasable TypeScript only.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type EvalHit = { kind: "new Function" | "eval"; offset: number };

/**
 * `new Function(` and a bare `eval(`. `eval` must be a whole word: not
 * `.evaluate(`, not `retrieval(`, not `$eval(`. A leading `.` is still a hit
 * (`window.eval(`).
 */
const EVAL_RE = /new\s+Function\s*\(|(?<![\w$])eval\s*\(/g;

/** Every eval-like call in `source`, with its character offset. */
export function findEvalCalls(source: string): EvalHit[] {
  return [...source.matchAll(EVAL_RE)].map((m) => ({
    kind: m[0].startsWith("new") ? "new Function" : "eval",
    offset: m.index ?? 0,
  }));
}

/**
 * Verified false positives, keyed by path relative to `out/engines/` (forward
 * slashes) to the offsets that are allowed. Add an entry only after reading
 * the code at that offset and confirming it is not reachable eval (a comment
 * or a string literal), and say why here.
 */
export const ALLOWLIST: Record<string, { offsets: number[]; reason: string }> =
  {
    // Webpack's global-object fallback: `try { return this || new Function(
    // "return this")() } catch { ... }` inside an IIFE that first returns
    // `globalThis` when it is an object. Every browser we support has
    // globalThis, so the eval branch is never reached. Offset is pinned to
    // the versioned directory, so an upgrade re-triggers review.
    "tesseract--7.0.0/worker.min.js": {
      offsets: [109468],
      reason: "webpack globalThis fallback, unreachable",
    },
  };

/**
 * Verified false positives in `out/_next/static/`, whose chunk names change
 * every build, so they're matched by the code around the hit instead of by
 * path and offset. Same rule as `ALLOWLIST`: read the code first, say why.
 */
export const SNIPPET_ALLOWLIST: { snippet: string; reason: string }[] = [
  {
    // vm-browserify's `Script.runInThisContext`, pulled in with the
    // crypto-browserify polyfill. Only runs if something calls `vm`; the
    // e2e suite exercises every tool under the production CSP.
    snippet: "runInThisContext=function(){return eval(this.code)}",
    reason: "vm-browserify shim, not called",
  },
];

/** Whether `hit` sits inside one of `SNIPPET_ALLOWLIST`'s snippets. */
export function isAllowedBySnippet(source: string, hit: EvalHit): boolean {
  return SNIPPET_ALLOWLIST.some(({ snippet }) => {
    const start = source.lastIndexOf(snippet, hit.offset);
    return start !== -1 && hit.offset < start + snippet.length;
  });
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.m?js$/.test(entry.name) ? [path] : [];
  });
}

function main(): void {
  const engines = join("out", "engines");
  const chunks = join("out", "_next", "static");
  if (!existsSync(engines) || !existsSync(chunks)) {
    console.error(
      "check-engine-eval: out/engines/ or out/_next/static/ not found. Run `pnpm build` first.",
    );
    process.exit(1);
  }
  const files = [...walk(engines), ...walk(chunks)];
  let failed = false;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = relative("out", file).split(sep).join("/");
    const allowed =
      ALLOWLIST[relative(engines, file).split(sep).join("/")]?.offsets ?? [];
    for (const hit of findEvalCalls(source)) {
      if (allowed.includes(hit.offset) || isAllowedBySnippet(source, hit)) {
        continue;
      }
      failed = true;
      console.error(
        `check-engine-eval: ${hit.kind} in out/${rel} at offset ${hit.offset}. ` +
          "The production CSP blocks eval: use the engine's CSP build, or add a patch in scripts/sync-engines.ts.",
      );
    }
  }
  if (failed) process.exit(1);
  // biome-ignore lint/suspicious/noConsole: stdout is the report.
  console.log(`check-engine-eval: ${files.length} scripts, no eval.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
