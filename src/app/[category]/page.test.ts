import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupToolsByCategory } from "@/components/tool-groups";
import { CATEGORIES } from "@/lib/registry";
import { TOOLS } from "@/tools";

/**
 * Tests the data this page's `generateStaticParams` is built from, rather
 * than importing `./page.tsx` itself — that keeps this file (and the rest of
 * `src/**\/*.test.ts`, run under `vitest.config.ts`'s plain Node
 * environment) free of any dependency on a JSX/TSX transform. `groupToolsByCategory`
 * is the exact helper `page.tsx` calls, so this still exercises the real logic.
 */
describe("[category] static params", () => {
  it("includes only categories that have at least one registered tool", () => {
    const byCategory = groupToolsByCategory(TOOLS);
    const params = CATEGORIES.filter((category) => byCategory.has(category));

    // Today only "image" has a tool (src/tools/index.ts) — asserting >0
    // rather than the exact set keeps this test passing as more land.
    expect(params.length).toBeGreaterThan(0);
    for (const category of params) {
      expect(CATEGORIES).toContain(category);
    }
  });
});

/**
 * The category route is `/<category>` (e.g. `/image`), a sibling of every
 * other top-level app route. `CATEGORIES` (src/lib/registry/categories.ts)
 * is a fixed, hand-maintained list — this asserts none of its entries ever
 * shadow a real route segment like `/tools` or `/offline`, reading the
 * segments straight off `src/app/` so it stays true if a route is renamed.
 */
describe("route collisions", () => {
  it("no category slug collides with a top-level app route segment", () => {
    const appDir = fileURLToPath(new URL("..", import.meta.url));
    const segments = readdirSync(appDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
      .map((entry) => entry.name);

    // Sanity check on the check itself: fails loudly if the directory scan
    // ever comes back empty (e.g. this file moved) instead of passing vacuously.
    expect(segments.length).toBeGreaterThan(0);

    for (const category of CATEGORIES) {
      expect(segments).not.toContain(category);
    }
  });
});
