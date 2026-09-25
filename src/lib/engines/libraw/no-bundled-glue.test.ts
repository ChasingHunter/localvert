import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression test for the build hang fixed alongside this file: a static
 * `import ... from "libraw-wasm/dist/libraw.js"` (or an unmarked dynamic
 * `import()` of the same specifier) makes Turbopack trace into that file's
 * Emscripten pthreads glue, which contains
 * `new Worker(new URL("libraw.js", import.meta.url), ...)` — a worker that
 * loads itself by its own module URL. Turbopack follows that self-reference
 * forever and `next build` never completes (confirmed by bisect: the commit
 * that introduced the static import hangs; the one before it builds in
 * ~48s). `./adapter.ts`'s `load()` now loads `libraw.js` at runtime instead,
 * from this engine's own `ctx.baseUrl`, via a `webpackIgnore`/
 * `turbopackIgnore`-annotated `import()` the bundlers must not trace into —
 * see that function's doc comment. This is a plain string check, not a type
 * check, because the whole point is to catch the pattern coming back even
 * if it did type-check.
 */
describe("libraw adapter does not statically bundle libraw-wasm's glue", () => {
  it("has no static import of libraw-wasm/dist/libraw.js", () => {
    const adapterPath = fileURLToPath(new URL("./adapter.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf8");

    // A static `import ... from "libraw-wasm/dist/libraw.js"` (or a bare,
    // un-ignored dynamic `import("libraw-wasm/dist/libraw.js")`) is what
    // sent Turbopack into the self-referential Worker it never returns
    // from. The runtime `import(`${ctx.baseUrl}libraw.js`)` this adapter
    // uses instead never contains this literal specifier string.
    expect(source).not.toContain('"libraw-wasm/dist/libraw.js"');
    expect(source).not.toContain("'libraw-wasm/dist/libraw.js'");
  });

  it("ignores the runtime libraw.js import with webpackIgnore/turbopackIgnore", () => {
    const adapterPath = fileURLToPath(new URL("./adapter.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf8");

    expect(source).toContain("webpackIgnore: true");
    expect(source).toContain("turbopackIgnore: true");
  });
});
