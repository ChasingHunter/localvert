import { describe, expect, it, vi } from "vitest";
import type {
  EngineAdapter,
  EngineInstance,
  EngineResult,
} from "@/lib/engines";
import type { EngineId, FormatId, Operation } from "@/lib/registry";
import { makeCaps } from "@/test/caps";
import { createEngineHost } from "./engine-host";
import type { RunRequest } from "./protocol";

// EngineId is a closed union of real, registered engines (today just
// "canvas" — see src/lib/registry/types.ts). This cast makes a synthetic id
// for exercising "nothing is registered for this engine" without depending
// on a second real engine existing yet, the same way define-engine.test.ts
// casts a synthetic marker.
const UNKNOWN_ENGINE = "unregistered-engine" as EngineId;

function baseReq(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    jobId: "job-1",
    engine: "canvas",
    baseUrl: "/engines/canvas@1.0.0/",
    op: "transcode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "png",
    outputFormat: "jpg",
    options: {},
    ...overrides,
  };
}

function makeAdapter(
  overrides: Partial<{
    supports: (op: Operation, i: FormatId, o: FormatId) => boolean;
    load: () => Promise<EngineInstance>;
  }> = {},
): EngineAdapter {
  return {
    id: "canvas",
    version: "1.0.0",
    license: "MIT",
    marker: "localvert-engine:canvas",
    location: "static",
    needsIsolation: false,
    heavy: false,
    supports: overrides.supports ?? (() => true),
    load:
      overrides.load ??
      (async () => ({
        run: async () => {
          throw new Error("not implemented");
        },
        dispose: () => {},
      })),
  };
}

const BYTES_RESULT: EngineResult = {
  kind: "bytes",
  bytes: new ArrayBuffer(0),
  mime: "image/jpeg",
};

describe("createEngineHost", () => {
  describe("loading", () => {
    it("loads an engine lazily and shares one load across concurrent runs", async () => {
      let loaderCalls = 0;
      let loadCalls = 0;
      const instance: EngineInstance = {
        run: async () => BYTES_RESULT,
        dispose: () => {},
      };
      const adapter = makeAdapter({
        load: async () => {
          loadCalls += 1;
          return instance;
        },
      });
      const host = createEngineHost(
        {
          canvas: async () => {
            loaderCalls += 1;
            return { default: adapter };
          },
        },
        () => makeCaps(),
      );

      const [a, b] = await Promise.all([
        host.run(baseReq({ jobId: "a" })),
        host.run(baseReq({ jobId: "b" })),
      ]);

      expect(loaderCalls).toBe(1);
      expect(loadCalls).toBe(1);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
    });

    it("returns ok:false unsupported when no loader is registered for the engine", async () => {
      const host = createEngineHost({}, () => makeCaps());
      const outcome = await host.run(baseReq({ engine: UNKNOWN_ENGINE }));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected ok:false");
      expect(outcome.error).toEqual({
        name: "EngineError",
        code: "unsupported",
        message: expect.stringContaining(UNKNOWN_ENGINE),
        engine: UNKNOWN_ENGINE,
      });
    });

    it("returns ok:false unsupported when the adapter rejects the op/format pair", async () => {
      const adapter = makeAdapter({ supports: () => false });
      const host = createEngineHost(
        { canvas: async () => ({ default: adapter }) },
        () => makeCaps(),
      );
      const outcome = await host.run(baseReq());
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected ok:false");
      expect(outcome.error.code).toBe("unsupported");
    });

    it("does not cache a load failure, so a retry can succeed", async () => {
      let attempt = 0;
      const instance: EngineInstance = {
        run: async () => BYTES_RESULT,
        dispose: () => {},
      };
      const adapter = makeAdapter({
        load: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error("network blip");
          return instance;
        },
      });
      const host = createEngineHost(
        { canvas: async () => ({ default: adapter }) },
        () => makeCaps(),
      );

      const first = await host.run(baseReq());
      expect(first.ok).toBe(false);
      if (first.ok) throw new Error("expected ok:false");
      expect(first.error.code).toBe("load-failed");

      const second = await host.run(baseReq());
      expect(second.ok).toBe(true);
      expect(attempt).toBe(2);
    });
  });

  describe("run outcomes", () => {
    it("maps a thrown error from instance.run through toEngineError", async () => {
      const adapter = makeAdapter({
        load: async () => ({
          run: async () => {
            throw new RangeError("out of memory allocating buffer");
          },
          dispose: () => {},
        }),
      });
      const host = createEngineHost(
        { canvas: async () => ({ default: adapter }) },
        () => makeCaps(),
      );
      const outcome = await host.run(baseReq());
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected ok:false");
      expect(outcome.error.code).toBe("out-of-memory");
    });

    it("maps an AbortError thrown by the adapter to code aborted", async () => {
      const adapter = makeAdapter({
        load: async () => ({
          run: async () => {
            throw new DOMException("stopped", "AbortError");
          },
          dispose: () => {},
        }),
      });
      const host = createEngineHost(
        { canvas: async () => ({ default: adapter }) },
        () => makeCaps(),
      );
      const outcome = await host.run(baseReq());
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected ok:false");
      expect(outcome.error.code).toBe("aborted");
    });
  });

  describe("cancel", () => {
    it("cancel(jobId) aborts that job's signal mid-run", async () => {
      let runReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        runReady = resolve;
      });

      const adapter = makeAdapter({
        load: async () => ({
          run: ({ signal }) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                reject(new DOMException("stopped", "AbortError"));
              });
              runReady();
            }),
          dispose: () => {},
        }),
      });
      const host = createEngineHost(
        { canvas: async () => ({ default: adapter }) },
        () => makeCaps(),
      );

      const pending = host.run(baseReq({ jobId: "job-x" }));
      await ready;
      host.cancel("job-x");

      const outcome = await pending;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected ok:false");
      expect(outcome.error.code).toBe("aborted");
    });

    it("is a no-op for an unknown job id", () => {
      const host = createEngineHost({}, () => makeCaps());
      expect(() => host.cancel("no-such-job")).not.toThrow();
    });
  });

  describe("progress", () => {
    it("throttles to ~10Hz, clamps to 0..1, and always delivers a final 1 on success", async () => {
      vi.useFakeTimers();
      try {
        let deliverOnProgress!: (f: number) => void;
        let finishRun!: (result: EngineResult) => void;
        let runReady!: () => void;
        const ready = new Promise<void>((resolve) => {
          runReady = resolve;
        });

        const adapter = makeAdapter({
          load: async () => ({
            run: (task) =>
              new Promise<EngineResult>((resolve) => {
                const { onProgress } = task;
                if (!onProgress) {
                  throw new Error("test setup: expected onProgress");
                }
                deliverOnProgress = onProgress;
                finishRun = resolve;
                runReady();
              }),
            dispose: () => {},
          }),
        });
        const host = createEngineHost(
          { canvas: async () => ({ default: adapter }) },
          () => makeCaps(),
        );

        const received: number[] = [];
        const pending = host.run(baseReq(), (f) => received.push(f));
        await ready;

        deliverOnProgress(-0.5); // clamps to 0; first call always gets through
        deliverOnProgress(0.4); // inside the 100ms window; throttled
        deliverOnProgress(0.5); // still inside; throttled

        vi.advanceTimersByTime(150);
        deliverOnProgress(1.5); // clamps to 1, window has reopened

        finishRun(BYTES_RESULT);
        const outcome = await pending;

        expect(received).toEqual([0, 1]);
        expect(outcome.ok).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("still delivers a final 1 when the last real update wasn't 1", async () => {
      vi.useFakeTimers();
      try {
        let finishRun!: (result: EngineResult) => void;
        let runReady!: () => void;
        const ready = new Promise<void>((resolve) => {
          runReady = resolve;
        });

        const adapter = makeAdapter({
          load: async () => ({
            run: (task) =>
              new Promise<EngineResult>((resolve) => {
                task.onProgress?.(0.3);
                finishRun = resolve;
                runReady();
              }),
            dispose: () => {},
          }),
        });
        const host = createEngineHost(
          { canvas: async () => ({ default: adapter }) },
          () => makeCaps(),
        );

        const received: number[] = [];
        const pending = host.run(baseReq(), (f) => received.push(f));
        await ready;
        expect(received).toEqual([0.3]);

        finishRun(BYTES_RESULT);
        await pending;

        expect(received).toEqual([0.3, 1]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("dispose", () => {
    it("disposes the cached instance and lets the next run reload it", async () => {
      let disposeCalls = 0;
      let loadCalls = 0;
      const adapter = makeAdapter({
        load: async () => {
          loadCalls += 1;
          return {
            run: async () => BYTES_RESULT,
            dispose: () => {
              disposeCalls += 1;
            },
          };
        },
      });
      const host = createEngineHost(
        { canvas: async () => ({ default: adapter }) },
        () => makeCaps(),
      );

      await host.run(baseReq());
      expect(loadCalls).toBe(1);

      host.dispose("canvas");
      expect(disposeCalls).toBe(1);

      await host.run(baseReq());
      expect(loadCalls).toBe(2);
    });

    it("is a no-op for an engine that was never loaded", () => {
      const host = createEngineHost({}, () => makeCaps());
      expect(() => host.dispose("canvas")).not.toThrow();
    });
  });

  describe("probe", () => {
    it("returns whatever the injected probe function returns", () => {
      const caps = makeCaps({ hardwareConcurrency: 2 });
      const host = createEngineHost({}, () => caps);
      expect(host.probe()).toBe(caps);
    });
  });
});
