import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import type { EngineTask } from "../types";
import adapter from "./adapter";

// heic-to compiles a multi-megabyte asm.js/wasm module and spins up its own
// internal worker on first use — well past vitest's 5s default.
const TIMEOUT = 30_000;

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "heic",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

// `import.meta.glob` is not `vite/client`-typed here — see the identical
// augmentation in `../libraw/adapter.browser.test.ts` for why.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: "?url"; import: "default" },
    ): Record<string, string>;
  }
}

/**
 * `fixtures/sample.heic` is a synthetic 64x48 HEIC generated for this repo
 * (four distinct coloured quadrants plus a gradient, encoded with
 * `pillow-heif`) — see `fixtures/README.md` for provenance. Discovered the
 * same way `../libraw/adapter.browser.test.ts` discovers its DNG fixture:
 * `import.meta.glob` gates `describe` at collection time, no runtime
 * filesystem access needed.
 */
const fixtureUrls = import.meta.glob("./fixtures/sample.heic", {
  eager: true,
  query: "?url",
  import: "default",
});
const fixtureUrl = Object.values(fixtureUrls)[0];

describe("heic adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("heic");
    expect(adapter.marker).toBe("localvert-engine:heic");
    expect(adapter.location).toBe("bundled");
    expect(adapter.license).toBe("LGPL-3.0");
  });

  describe("supports", () => {
    it("accepts decode from heic to raster", () => {
      expect(adapter.supports("decode", "heic", "raster")).toBe(true);
    });

    it("rejects a non-decode op", () => {
      expect(adapter.supports("encode", "heic", "raster")).toBe(false);
    });

    it("rejects a non-heic input", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(false);
    });

    it("rejects a non-raster output", () => {
      expect(adapter.supports("decode", "heic", "heic")).toBe(false);
    });
  });

  describe("run", () => {
    // Exercises the failure path on bytes that aren't HEIC at all, which
    // still proves `load()` actually initialises `heic-to/next` (including
    // its internal worker) inside this adapter's own worker context without
    // violating `connect-src 'self'`: a fixture pointed at a disallowed
    // origin would reject with a CSP console error, not a clean
    // `decode-failed`. The real-fixture decode path is covered by the
    // `describe.skipIf` block below.
    it(
      "throws EngineError('decode-failed') on garbage bytes",
      async () => {
        const instance = await adapter.load({
          baseUrl: "",
          capabilities: {} as never,
        });
        const garbage = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);

        await expect(
          instance.run(baseTask({ input: { kind: "blob", blob: garbage } })),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "decode-failed",
        );
      },
      TIMEOUT,
    );

    it(
      "throws EngineError('aborted') when the signal is already aborted",
      async () => {
        const instance = await adapter.load({
          baseUrl: "",
          capabilities: {} as never,
        });
        const controller = new AbortController();
        controller.abort();
        const garbage = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);

        await expect(
          instance.run(
            baseTask({
              input: { kind: "blob", blob: garbage },
              signal: controller.signal,
            }),
          ),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "aborted",
        );
      },
      TIMEOUT,
    );

    describe.skipIf(!fixtureUrl)("with a real fixture", () => {
      it(
        "decodes a real heic file to a plausible, fully-opaque raster image",
        async () => {
          const instance = await adapter.load({
            baseUrl: "",
            capabilities: {} as never,
          });
          const blob = await (await fetch(fixtureUrl as string)).blob();

          const result = await instance.run(
            baseTask({ input: { kind: "blob", blob } }),
          );
          if (result.kind !== "raster") {
            throw new Error("expected a raster result");
          }
          // The fixture is a synthetic 64x48 image (see
          // fixtures/README.md) — HEVC's 4:2:0 chroma subsampling needs
          // even dimensions, which 64x48 already is, so the decode should
          // come back at exactly the encoded size, no conformance cropping.
          expect(result.image.width).toBe(64);
          expect(result.image.height).toBe(48);
          expect(result.image.data.length).toBe(
            result.image.width * result.image.height * 4,
          );
          // The source has no alpha channel — every decoded pixel must
          // come out fully opaque.
          for (let i = 3; i < result.image.data.length; i += 4 * 37) {
            expect(result.image.data[i]).toBe(255);
          }

          // The fixture's four quadrants are distinct, saturated colours
          // (see fixtures/README.md) — lossy HEVC encoding shifts exact
          // values, so this checks which channel dominates at each
          // quadrant's centre rather than exact RGB values.
          const pixelAt = (x: number, y: number) => {
            const i = (y * result.image.width + x) * 4;
            const d = result.image.data;
            return { r: d[i] ?? 0, g: d[i + 1] ?? 0, b: d[i + 2] ?? 0 };
          };
          const margin = 20;

          const topLeft = pixelAt(16, 12); // red
          expect(topLeft.r).toBeGreaterThan(topLeft.g + margin);
          expect(topLeft.r).toBeGreaterThan(topLeft.b + margin);

          const topRight = pixelAt(48, 12); // green
          expect(topRight.g).toBeGreaterThan(topRight.r + margin);
          expect(topRight.g).toBeGreaterThan(topRight.b + margin);

          const bottomLeft = pixelAt(16, 36); // blue
          expect(bottomLeft.b).toBeGreaterThan(bottomLeft.r + margin);
          expect(bottomLeft.b).toBeGreaterThan(bottomLeft.g + margin);

          const bottomRight = pixelAt(48, 36); // yellow: high r+g, low b
          expect(bottomRight.r).toBeGreaterThan(bottomRight.b + margin);
          expect(bottomRight.g).toBeGreaterThan(bottomRight.b + margin);
        },
        TIMEOUT,
      );
    });
  });
});
