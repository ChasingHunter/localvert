import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { describeFields } from "@/lib/options/fields";
import { FORMATS } from "@/lib/registry";
import { TOOLS, TOOLS_BY_SLUG } from "./index";
import { TOOL_LOADERS } from "./loaders";

/** Every `.ts`/`.tsx` file under `dir`, recursively, as absolute paths. */
function listSourceFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFilesRecursive(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Cross-checks the generated `TOOLS` barrel against the generated
 * `TOOL_LOADERS` map and the rest of the registry. These two files are
 * generated from the same scan (`scanTools` in scripts/gen-registry.ts), so
 * in principle they can never disagree — this test exists to catch the case
 * where they do: a stale `pnpm gen` run, or a tool's `slug` field edited by
 * hand to no longer match its own filename (the convention `TOOL_LOADERS`'s
 * keys depend on, see docs/ADDING_A_TOOL.md).
 */
describe("TOOLS", () => {
  it("every tool's slug equals its file basename", () => {
    // TOOL_LOADERS's keys are exactly the scanned file basenames (see
    // genToolsLoaders) — the expected set this test derives from, per the
    // slice brief.
    const expectedSlugs = new Set(Object.keys(TOOL_LOADERS));
    for (const tool of TOOLS) {
      expect(expectedSlugs.has(tool.slug)).toBe(true);
    }
  });

  it("has unique slugs", () => {
    const slugs = TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every pipeline engine id exists in ENGINE_MANIFEST", () => {
    for (const tool of TOOLS) {
      for (const step of tool.pipeline) {
        for (const candidate of step.candidates) {
          expect(candidate.engine in ENGINE_MANIFEST).toBe(true);
        }
      }
    }
  });

  it("every accepts/produces format is known", () => {
    for (const tool of TOOLS) {
      for (const format of tool.accepts) {
        expect(format in FORMATS).toBe(true);
      }
      // "same" (produces === input's own sniffed format, e.g. strip-exif)
      // isn't a FORMATS key — see ToolDefinition.produces's doc comment.
      expect(tool.produces === "same" || tool.produces in FORMATS).toBe(true);
    }
  });

  it("TOOLS_BY_SLUG indexes every tool by its slug", () => {
    for (const tool of TOOLS) {
      expect(TOOLS_BY_SLUG.get(tool.slug)).toBe(tool);
    }
    expect(TOOLS_BY_SLUG.size).toBe(TOOLS.length);
  });

  /**
   * Regression test for the core-bundle leak fixed alongside this test: a
   * tool definition under `src/tools/**` is reachable from every
   * server-rendered page through the `src/tools/index.ts` barrel (home,
   * category and tool pages all import it for their static listings). An
   * `import()` in a tool file targeting a "use client" component — as
   * `pdf-editor.ts`'s `app` field once did, resolving the PDF editor's own
   * component — makes Next register that component as a client reference
   * for every page reachable through the barrel, not just the one page that
   * renders it. That shipped the editor's `@embedpdf`/PDFium code in the
   * first-load JS of every tool page and the home page, up to the 300 KB
   * budget ceiling regardless of slug. A `kind: "app"` tool now names its
   * app by a plain string id (`ToolDefinition.app`, an `AppId`) instead,
   * resolved to a real component only inside `src/components/app-registry.tsx`
   * — a client-only module `src/tools/**` never touches. This is a plain
   * string scan, not a type check, because the whole point is to catch the
   * pattern coming back even if it did type-check (e.g. via a re-exported
   * alias for `@/components/...`).
   */
  it("no tool definition imports UI (import() of @/components)", () => {
    const toolsDir = dirname(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
    );
    const offenders: string[] = [];
    for (const file of listSourceFilesRecursive(toolsDir)) {
      if (file.endsWith("registry.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      if (/import\(\s*["'`]@\/components\//.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The options form builds its fields with `describeFields`, which throws on
  // any field missing a label or control — that crashed /tools/mute-video at
  // render time (2026-09-27). Every tool's schema must describe cleanly.
  it.each(TOOLS.map((t) => [t.slug, t] as const))(
    "%s: every option field describes for the options form",
    (_slug, tool) => {
      expect(() => describeFields(tool.options)).not.toThrow();
    },
  );
});
