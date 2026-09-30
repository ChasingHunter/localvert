import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { patchLibrawGlue } from "./sync-engines";

/**
 * `patchLibrawGlue` removes the two `new Function(...)` sites in
 * `libraw-wasm`'s Emscripten glue (see its doc comment in `sync-engines.ts`).
 * The real browser proof is the e2e run of raw-to-jpg against a built `out/`
 * with the production CSP; these tests make a `libraw-wasm` upgrade that
 * reshapes either site fail here, loudly, instead of in a browser.
 */
function readRealGlue(): string {
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(require.resolve("libraw-wasm/package.json"));
  return readFileSync(join(pkgDir, "dist", "libraw.js"), "utf8");
}

describe("patchLibrawGlue", () => {
  it("removes every new Function( from the real installed glue", () => {
    const real = readRealGlue();
    expect(real).toContain("new Function(");
    const patched = patchLibrawGlue(real);
    expect(patched).not.toContain("new Function(");
    expect(patched).toContain("function ni(e,r,t,n){");
    expect(patched).toContain("xi=(e,r,t)=>{");
  });

  it("throws if the invoker factory shape changes", () => {
    const real = readRealGlue().replace(
      "function ni(e,r,t,n){",
      "function nx(e,r,t,n){",
    );
    expect(() => patchLibrawGlue(real)).toThrow(/invoker factory, found 0/);
  });

  it("throws if the method caller shape changes", () => {
    const real = readRealGlue().replace("xi=(e,r,t)=>{", "xx=(e,r,t)=>{");
    expect(() => patchLibrawGlue(real)).toThrow(/method caller, found 0/);
  });
});
