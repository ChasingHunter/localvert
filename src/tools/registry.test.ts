import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { FORMATS } from "@/lib/registry";
import { TOOLS, TOOLS_BY_SLUG } from "./index";
import { TOOL_LOADERS } from "./loaders";

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
      expect(tool.produces in FORMATS).toBe(true);
    }
  });

  it("TOOLS_BY_SLUG indexes every tool by its slug", () => {
    for (const tool of TOOLS) {
      expect(TOOLS_BY_SLUG.get(tool.slug)).toBe(tool);
    }
    expect(TOOLS_BY_SLUG.size).toBe(TOOLS.length);
  });
});
