import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-0019's guard: no module the main thread runs on a tool page may import
 * zod, the tool modules, or `defineTool`. Walks the static + dynamic import
 * graph (type-only imports are erased and skipped) from the main-thread
 * entry points a tool page uses. `new Worker(new URL(...))` is not an import,
 * so the worker side, where zod belongs, is never entered.
 */
const SRC = resolve(__dirname, "..", "..");

const ENTRY_POINTS = [
  "components/tool-runner.tsx",
  "components/options-form.tsx",
  "components/crop-editor.tsx",
  "components/video-range-editor.tsx",
  "components/size-estimate.tsx",
  "components/engine-consent-dialog.tsx",
  "lib/jobs/app.ts",
  "lib/engines/consent-gate.ts",
  "lib/estimate/index.ts",
  "lib/workers/spawn.ts",
];

/** Anything under these, or the bare `zod` package, is off limits. */
const FORBIDDEN = [
  /^zod(\/|$)/,
  /^@\/tools\/(loaders|index)$/,
  /^@\/tools\/(audio|data|document|image|pdf|video)\//,
  /^@\/lib\/registry\/define-tool$/,
  /^@\/lib\/registry$/, // the barrel re-exports defineTool
  /^@\/lib\/options\/fields$/, // describeFields/validateOptions import zod
  /^@\/tools\/client-tool$/,
];

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function resolveFile(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // a package: only zod itself matters, checked by FORBIDDEN
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null; // json, css, generated-away files...
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    if (match[1]) continue; // `import type` / `export type`
    const spec = match[2] ?? match[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

function findViolations(entries: readonly string[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  const queue: { file: string; chain: string[] }[] = entries.map((e) => ({
    file: join(SRC, e),
    chain: [e],
  }));
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || seen.has(item.file)) continue;
    seen.add(item.file);
    for (const spec of importsOf(item.file)) {
      const forbidden = FORBIDDEN.find((re) => re.test(spec));
      if (forbidden) {
        violations.push(`${[...item.chain, spec].join(" -> ")}`);
        continue;
      }
      const next = resolveFile(spec, item.file);
      if (next && !next.endsWith(".test.ts") && !next.endsWith(".test.tsx")) {
        queue.push({
          file: next,
          chain: [
            ...item.chain,
            next.slice(SRC.length + 1).replaceAll("\\", "/"),
          ],
        });
      }
    }
  }
  return violations;
}

describe("zod stays off the main thread (ADR-0019)", () => {
  it("no main-thread entry point reaches zod, a tool module or defineTool", () => {
    expect(findViolations(ENTRY_POINTS)).toEqual([]);
  });

  it("would notice if one did", () => {
    // define-tool.ts imports zod; a module that imports it is caught.
    expect(findViolations(["lib/registry/define-tool.ts"])).toEqual([
      "lib/registry/define-tool.ts -> zod",
    ]);
    expect(findViolations(["tools/client-tool.ts"])).not.toEqual([]);
  });
});
