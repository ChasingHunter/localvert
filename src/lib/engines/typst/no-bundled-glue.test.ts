import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression test for the bundling problem `adapter.ts`'s top doc comment
 * describes: `@myriaddreamin/typst.ts`'s own `compiler.mjs` contains a bare
 * `import('@myriaddreamin/typst-ts-web-compiler')` — a static import site a
 * bundler resolves at build time (pulling its 28 MB wasm into a build chunk)
 * regardless of which runtime branch ever executes it. This adapter must
 * never import that wrapper package at all, static or dynamic, and must load
 * its own copy of the raw compiler's glue only via the ignored, runtime
 * `import()` below — plain string checks, not type checks, since the whole
 * point is to catch either pattern coming back even if it did type-check.
 */
describe("typst adapter does not statically bundle either typst.ts package", () => {
  it("has no import of the @myriaddreamin/typst.ts wrapper package", () => {
    const adapterPath = fileURLToPath(new URL("./adapter.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf8");

    expect(source).not.toContain('"@myriaddreamin/typst.ts"');
    expect(source).not.toContain("'@myriaddreamin/typst.ts'");
  });

  it("has no static/bare import of @myriaddreamin/typst-ts-web-compiler", () => {
    const adapterPath = fileURLToPath(new URL("./adapter.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf8");

    expect(source).not.toContain('"@myriaddreamin/typst-ts-web-compiler"');
    expect(source).not.toContain("'@myriaddreamin/typst-ts-web-compiler'");
  });

  it("ignores the runtime glue import with webpackIgnore/turbopackIgnore", () => {
    const adapterPath = fileURLToPath(new URL("./adapter.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf8");

    expect(source).toContain("webpackIgnore: true");
    expect(source).toContain("turbopackIgnore: true");
  });
});
