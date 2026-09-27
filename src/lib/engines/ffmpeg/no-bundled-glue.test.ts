import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Same reasoning as `../libraw/no-bundled-glue.test.ts`: `@ffmpeg/core`'s
 * ESM glue (`dist/esm/ffmpeg-core.js`) resolves its wasm relative to its own
 * `import.meta.url` unless `locateFile` overrides that. A static import (or
 * an un-ignored dynamic one) would let the bundler place this GPL-2.0-or-
 * later glue in the app bundle and resolve its wasm against the wrong URL —
 * invariant 3 and ADR-0002 rule 4 both depend on this staying a runtime
 * import. This is a plain string check, not a type check, so the pattern is
 * still caught even if it type-checked fine.
 */
describe("ffmpeg adapter does not statically bundle @ffmpeg/core's glue", () => {
  it("has no static import of @ffmpeg/core", () => {
    const adapterPath = fileURLToPath(new URL("./adapter.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf8");

    expect(source).not.toContain('from "@ffmpeg/core"');
    expect(source).not.toContain("from '@ffmpeg/core'");
  });

  it("ignores the runtime ffmpeg-core.js import with webpackIgnore/turbopackIgnore", () => {
    const adapterPath = fileURLToPath(new URL("./adapter.ts", import.meta.url));
    const source = readFileSync(adapterPath, "utf8");

    expect(source).toContain("webpackIgnore: true");
    expect(source).toContain("turbopackIgnore: true");
  });
});
