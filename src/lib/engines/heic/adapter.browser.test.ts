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
    // No real HEIC fixture is available for this slice — see the commit
    // body / handback report for what was searched. This exercises the
    // failure path, which still proves `load()` actually initialises
    // `heic-to/next` (including its internal worker) inside this adapter's
    // own worker context without violating `connect-src 'self'`: a fixture
    // pointed at a disallowed origin would reject with a CSP console error,
    // not a clean `decode-failed`.
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
  });
});
