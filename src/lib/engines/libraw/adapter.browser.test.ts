import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { isEngineError } from "../errors";
import type { EngineTask } from "../types";
import adapter from "./adapter";

// libraw-wasm compiles a ~1.4 MB Emscripten module on first `load()` — well
// past vitest's 5s default, same reasoning as heic's adapter.browser.test.ts.
const TIMEOUT = 30_000;

/**
 * The real, `pnpm sync-engines`-populated asset path — proves the adapter
 * loads its wasm from our own versioned origin, never a CDN or wherever the
 * app bundler happens to place `libraw-wasm`'s own worker chunk. See
 * `./adapter.ts`'s `load` doc comment for why that distinction matters here
 * specifically.
 */
function baseUrl(): string {
  return ENGINE_MANIFEST.libraw.baseUrl;
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "blob", blob: new Blob() },
    inputFormat: "raw",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

// `import.meta.glob` is not `vite/client`-typed here — `vite` is only a
// transitive dependency of `vitest`, so pnpm's strict node_modules layout
// doesn't expose it for a `/// <reference types="vite/client" />` to
// resolve. This augments just the one member this file actually calls.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { eager: true; query: "?url"; import: "default" },
    ): Record<string, string>;
  }
}

/**
 * No free, license-clean tiny camera raw sample exists to commit as a test
 * fixture — every real-world CR2/NEF/DNG/... file this session could find is
 * either copyrighted press material or tens of megabytes (see
 * `fixtures/README.md`). `import.meta.glob` is a Vite build-time feature —
 * this file runs in an actual browser via vitest's browser mode, itself
 * Vite-powered — that reports which files matching a pattern exist on disk
 * with no runtime filesystem access needed, so it can gate `describe` at
 * collection time. Drop a small, license-clean DNG at `fixtures/sample.dng`
 * and the decode assertions below start running with no code change here.
 */
const fixtureUrls = import.meta.glob("./fixtures/sample.dng", {
  eager: true,
  query: "?url",
  import: "default",
});
const fixtureUrl = Object.values(fixtureUrls)[0];

describe("libraw adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("libraw");
    expect(adapter.marker).toBe("localvert-engine:libraw");
    expect(adapter.location).toBe("static");
    expect(adapter.needsIsolation).toBe(false);
    expect(adapter.heavy).toBe(true);
  });

  describe("supports", () => {
    it("accepts decode from raw to raster", () => {
      expect(adapter.supports("decode", "raw", "raster")).toBe(true);
    });

    it("rejects a non-decode op", () => {
      expect(adapter.supports("encode", "raw", "raster")).toBe(false);
    });

    it("rejects a non-raw input", () => {
      expect(adapter.supports("decode", "tiff", "raster")).toBe(false);
    });

    it("rejects a non-raster output", () => {
      expect(adapter.supports("decode", "raw", "raw")).toBe(false);
    });
  });

  describe("run", () => {
    it(
      "throws EngineError('decode-failed') on garbage bytes",
      async () => {
        const instance = await adapter.load({
          baseUrl: baseUrl(),
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
          baseUrl: baseUrl(),
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
        "decodes a real raw file to a plausible, fully-opaque raster image",
        async () => {
          const instance = await adapter.load({
            baseUrl: baseUrl(),
            capabilities: {} as never,
          });
          const blob = await (await fetch(fixtureUrl as string)).blob();

          const result = await instance.run(
            baseTask({ input: { kind: "blob", blob } }),
          );
          if (result.kind !== "raster") {
            throw new Error("expected a raster result");
          }
          expect(result.image.width).toBeGreaterThan(0);
          expect(result.image.height).toBeGreaterThan(0);
          expect(result.image.data.length).toBe(
            result.image.width * result.image.height * 4,
          );
          // Camera raw has no alpha channel — every pixel must come out
          // fully opaque. Sampled, not exhaustive, to stay fast.
          for (let i = 3; i < result.image.data.length; i += 4 * 997) {
            expect(result.image.data[i]).toBe(255);
          }
        },
        TIMEOUT,
      );

      it(
        "halfSize decodes to smaller dimensions than a full decode",
        async () => {
          const instance = await adapter.load({
            baseUrl: baseUrl(),
            capabilities: {} as never,
          });
          const blob = await (await fetch(fixtureUrl as string)).blob();

          const full = await instance.run(
            baseTask({ input: { kind: "blob", blob } }),
          );
          const half = await instance.run(
            baseTask({
              input: { kind: "blob", blob },
              options: { halfSize: true },
            }),
          );
          if (full.kind !== "raster" || half.kind !== "raster") {
            throw new Error("expected raster results");
          }
          expect(half.image.width).toBeLessThan(full.image.width);
        },
        TIMEOUT,
      );
    });
  });
});
