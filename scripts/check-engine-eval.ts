/**
 * Engine eval guard: part of `pnpm verify`, run after the build.
 *
 * The production CSP has no `unsafe-eval`, so any engine JS that calls
 * `new Function(...)` or `eval(...)` throws an EvalError in the browser.
 * Vitest browser mode runs without that CSP, so adapter tests can't see it
 * (HEIC and RAW shipped broken this way). This scans every `.js`/`.mjs` under
 * `out/engines/` for those two calls and fails the build on a hit.
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

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.m?js$/.test(entry.name) ? [path] : [];
  });
}

function main(): void {
  const root = join("out", "engines");
  if (!existsSync(root)) {
    console.error(
      "check-engine-eval: out/engines/ not found. Run `pnpm build` first.",
    );
    process.exit(1);
  }
  const files = walk(root);
  let failed = false;
  for (const file of files) {
    const rel = relative(root, file).split(sep).join("/");
    const allowed = ALLOWLIST[rel]?.offsets ?? [];
    for (const hit of findEvalCalls(readFileSync(file, "utf8"))) {
      if (allowed.includes(hit.offset)) continue;
      failed = true;
      console.error(
        `check-engine-eval: ${hit.kind} in out/engines/${rel} at offset ${hit.offset}. ` +
          "The production CSP blocks eval: use the engine's CSP build, or add a patch in scripts/sync-engines.ts.",
      );
    }
  }
  if (failed) process.exit(1);
  // biome-ignore lint/suspicious/noConsole: stdout is the report.
  console.log(`check-engine-eval: ${files.length} engine scripts, no eval.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
