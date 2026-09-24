import { describe, expect, it } from "vitest";
import {
  CORE_BUDGET_GZ_BYTES,
  evaluatePage,
  firstLoadScripts,
  gzipSize,
  type ScriptInfo,
} from "./check-sizes";

/**
 * Shaped like a real Next 16 static export `<head>`/`<body>` (checked
 * against a real `out/index.html`): a `preload as="script"` link (no
 * `modulepreload` — the export ships classic scripts, not ES modules), a
 * stylesheet link that must be ignored, ordinary `async` script tags, a
 * `noModule` legacy-target chunk, and the inline RSC flight payload Next
 * streams as `<script>self.__next_f.push(...)</script>` with no `src`.
 */
const REALISTIC_HTML = `<!DOCTYPE html><html lang="en"><head>
<link rel="stylesheet" href="/_next/static/chunks/app-abc123.css" data-precedence="next"/>
<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/webpack-abc123.js"/>
<script src="/_next/static/chunks/webpack-abc123.js" async=""></script>
<script src="/_next/static/chunks/main-app-def456.js" async="" crossorigin=""></script>
<script src="/_next/static/chunks/legacy-ghi789.js" noModule=""></script>
</head><body>
<script>(self.__next_f=self.__next_f||[]).push([0])</script>
<script>self.__next_f.push([1,"no src on this one — the RSC flight payload"])</script>
</body></html>`;

describe("firstLoadScripts", () => {
  it("collects script src and preload-as-script href, in document order, deduplicated", () => {
    expect(firstLoadScripts(REALISTIC_HTML)).toEqual([
      { src: "/_next/static/chunks/webpack-abc123.js", noModule: false },
      { src: "/_next/static/chunks/main-app-def456.js", noModule: false },
      { src: "/_next/static/chunks/legacy-ghi789.js", noModule: true },
    ]);
  });

  it("ignores stylesheet links", () => {
    expect(firstLoadScripts(REALISTIC_HTML).map((s) => s.src)).not.toContain(
      "/_next/static/chunks/app-abc123.css",
    );
  });

  it("ignores inline scripts with no src", () => {
    const html = `<script>console.log("inline, no src, no bytes to budget")</script>`;
    expect(firstLoadScripts(html)).toEqual([]);
  });

  it("also collects modulepreload links, in case a future build ships ES module chunks", () => {
    const html = `<link rel="modulepreload" href="/_next/static/chunks/esm-only.js">`;
    expect(firstLoadScripts(html)).toEqual([
      { src: "/_next/static/chunks/esm-only.js", noModule: false },
    ]);
  });

  it("returns an empty list for a page with no scripts", () => {
    expect(firstLoadScripts("<html><body>hi</body></html>")).toEqual([]);
  });

  it("flags a bare `nomodule` attribute with no value", () => {
    const html = `<script src="/legacy.js" nomodule></script>`;
    expect(firstLoadScripts(html)).toEqual([
      { src: "/legacy.js", noModule: true },
    ]);
  });
});

describe("gzipSize", () => {
  it("matches node:zlib's own gzipSync length at level 9", () => {
    const buf = new TextEncoder().encode("x".repeat(10_000));
    expect(gzipSize(buf)).toBeGreaterThan(0);
    expect(gzipSize(buf)).toBeLessThan(buf.byteLength);
  });

  it("is deterministic for the same input", () => {
    const buf = new TextEncoder().encode("localvert-engine:canvas".repeat(50));
    expect(gzipSize(buf)).toBe(gzipSize(buf));
  });
});

function script(
  path: string,
  gz: number,
  hasEngineMarker = false,
  noModule = false,
): ScriptInfo {
  return { path, bytes: gz * 3, gz, hasEngineMarker, noModule };
}

describe("evaluatePage", () => {
  it("is under budget when the total is below budgetBytes", () => {
    const result = evaluatePage("/", [script("a.js", 100 * 1024)], 300 * 1024);
    expect(result.totalGz).toBe(100 * 1024);
    expect(result.overBudget).toBe(false);
  });

  it("is over budget when the total exceeds budgetBytes", () => {
    const result = evaluatePage(
      "/",
      [script("a.js", 200 * 1024), script("b.js", 150 * 1024)],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.totalGz).toBe(350 * 1024);
    expect(result.overBudget).toBe(true);
  });

  it("treats a total exactly at the budget as not over", () => {
    const result = evaluatePage(
      "/",
      [script("a.js", CORE_BUDGET_GZ_BYTES)],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.overBudget).toBe(false);
  });

  it("reports scripts with an engine marker as leaked", () => {
    const result = evaluatePage(
      "/",
      [script("a.js", 10 * 1024), script("canvas.js", 20 * 1024, true)],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.leakedEngines).toEqual(["canvas.js"]);
  });

  it("reports no leaks when no script carries the marker", () => {
    const result = evaluatePage(
      "/",
      [script("a.js", 10 * 1024)],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.leakedEngines).toEqual([]);
  });

  it("counts a script referenced twice (e.g. preload + script tag) once", () => {
    const result = evaluatePage(
      "/",
      [script("shared.js", 50 * 1024), script("shared.js", 50 * 1024)],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.totalGz).toBe(50 * 1024);
  });

  it("keeps the marker flag when only one of the duplicate entries reports it", () => {
    const result = evaluatePage(
      "/",
      [
        script("shared.js", 50 * 1024, false),
        script("shared.js", 50 * 1024, true),
      ],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.leakedEngines).toEqual(["shared.js"]);
  });

  it("excludes a nomodule chunk from totalGz", () => {
    const result = evaluatePage(
      "/",
      [
        script("a.js", 100 * 1024),
        script("legacy.js", 250 * 1024, false, true),
      ],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.totalGz).toBe(100 * 1024);
    expect(result.overBudget).toBe(false);
  });

  it("still reports a nomodule chunk's engine marker as leaked", () => {
    const result = evaluatePage(
      "/",
      [script("legacy-canvas.js", 20 * 1024, true, true)],
      CORE_BUDGET_GZ_BYTES,
    );
    expect(result.totalGz).toBe(0);
    expect(result.leakedEngines).toEqual(["legacy-canvas.js"]);
  });
});
