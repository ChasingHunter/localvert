import { describe, expect, it, vi } from "vitest";
import type {
  EngineAdapter,
  EngineInput,
  EngineResult,
  EngineTask,
} from "@/lib/engines";
import { EngineError, isEngineError } from "@/lib/engines";
import type { EngineId } from "@/lib/registry";
import { makeCaps } from "@/test/caps";
import { createEngineHost } from "./engine-host";
import type { WorkerHandle } from "./pool";
import { createWorkerPool } from "./pool";
import type { RunRequest, RunStep } from "./protocol";

/**
 * Fake `WorkerHandle`s backed by a real `createEngineHost` instance each —
 * so a "spawned worker" in these tests runs the actual host logic (lazy
 * load, `supports()` gating, error mapping) rather than a hand-rolled
 * stand-in for it. Only the transport (`api.*` returning promises, and
 * `terminate()`) is faked.
 */

const CANVAS: EngineId = "canvas";
// EngineId is a closed union of real, registered engines (today just
// "canvas" — see src/lib/registry/types.ts). This cast makes a second,
// synthetic id so pool tests can exercise the heavy/light split, the same
// way engine-host.test.ts casts a synthetic id for "no loader registered".
const HEAVY_ENGINE = "fake-heavy" as EngineId;
// A second, distinct heavy engine id — only used to test that a
// multi-step request pins to the *first* heavy engine among its steps, not
// just *a* heavy one.
const HEAVY_ENGINE_2 = "fake-heavy-2" as EngineId;

type Loaders = Partial<
  Record<EngineId, () => Promise<{ default: EngineAdapter }>>
>;

interface ControlledRun {
  task: EngineTask;
  resolve: (result: EngineResult) => void;
  reject: (err: unknown) => void;
}

/** Tracks `run()` calls an adapter makes, in the order they start, and lets
 * a test await "the next one to start" regardless of whether it has already
 * started (backlogged) or hasn't yet — the async load chain in front of it
 * (loader() -> adapter.load() -> instance.run()) takes a few microtask hops,
 * so tests can't assume a `run()` call has reached the adapter synchronously. */
function runTracker() {
  const started: ControlledRun[] = [];
  let claimed = 0;
  let waiter: ((run: ControlledRun) => void) | null = null;

  function onStart(run: ControlledRun): void {
    started.push(run);
    if (waiter) {
      const w = waiter;
      waiter = null;
      claimed += 1;
      w(run);
    }
  }

  function nextStart(): Promise<ControlledRun> {
    if (claimed < started.length) {
      const run = started[claimed];
      claimed += 1;
      // biome-ignore lint/style/noNonNullAssertion: guarded by the length check above
      return Promise.resolve(run!);
    }
    return new Promise((resolve) => {
      waiter = resolve;
    });
  }

  return { started, onStart, nextStart };
}

/** A controllable adapter: `run()` never settles on its own — the test
 * settles it via the `ControlledRun` handed to `onStart`. Honors abort by
 * default, standing in for a well-behaved (JS-side) engine. */
function makeControlledAdapter(
  id: EngineId,
  heavy: boolean,
  onStart: (run: ControlledRun) => void,
): EngineAdapter {
  return {
    id,
    version: "1.0.0",
    license: "MIT",
    marker: `localvert-engine:${id}` as EngineAdapter["marker"],
    location: "static",
    needsIsolation: false,
    heavy,
    supports: () => true,
    load: async () => ({
      run: (task: EngineTask) =>
        new Promise<EngineResult>((resolve, reject) => {
          task.signal.addEventListener("abort", () => {
            reject(new DOMException("stopped", "AbortError"));
          });
          onStart({ task, resolve, reject });
        }),
      dispose: () => {},
    }),
  };
}

/** Same shape, but its `run()` never looks at `task.signal` at all — stands
 * in for a synchronous wasm loop that cannot observe cancellation, which is
 * exactly the case the pool's cancel-grace-then-terminate path exists for. */
function makeStuckAdapter(
  id: EngineId,
  onStart: (run: ControlledRun) => void,
): EngineAdapter {
  return {
    id,
    version: "1.0.0",
    license: "MIT",
    marker: `localvert-engine:${id}` as EngineAdapter["marker"],
    location: "static",
    needsIsolation: false,
    heavy: false,
    supports: () => true,
    load: async () => ({
      run: (task: EngineTask) =>
        new Promise<EngineResult>((resolve, reject) => {
          onStart({ task, resolve, reject });
        }),
      dispose: () => {},
    }),
  };
}

interface FakeWorker {
  handle: WorkerHandle;
  terminate: ReturnType<typeof vi.fn>;
  disposeCalls: EngineId[];
}

function makeWorkerHandle(
  loaders: Loaders,
  opts: { crashOnFirstRun?: boolean } = {},
): FakeWorker {
  const host = createEngineHost(loaders, () => makeCaps());
  const disposeCalls: EngineId[] = [];
  let crashNext = opts.crashOnFirstRun ?? false;
  const terminate = vi.fn();

  const handle: WorkerHandle = {
    api: {
      probe: async () => host.probe(),
      run: async (req, onProgress) => {
        if (crashNext) {
          crashNext = false;
          throw new Error("simulated worker crash");
        }
        return host.run(req, onProgress);
      },
      cancel: async (jobId) => {
        host.cancel(jobId);
      },
      dispose: async (engine) => {
        disposeCalls.push(engine);
        host.dispose(engine);
      },
    },
    terminate,
  };

  return { handle, terminate, disposeCalls };
}

/** `noUncheckedIndexedAccess` makes `arr[i]` come back possibly `undefined`
 * even right after a length/existence check elsewhere — this reads it back
 * as the concrete type, throwing (never in a passing test) if the index
 * really is out of range. */
function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected index ${i} to exist`);
  return v;
}

function makePool(opts: {
  loaders: Loaders;
  size?: number;
  isHeavy?: (engine: EngineId) => boolean;
  heavyIdleMs?: number;
  cancelGraceMs?: number;
}) {
  const spawned: FakeWorker[] = [];
  const pool = createWorkerPool({
    size: opts.size ?? 2,
    isHeavy: opts.isHeavy ?? (() => false),
    heavyIdleMs: opts.heavyIdleMs,
    cancelGraceMs: opts.cancelGraceMs,
    spawn: () => {
      const w = makeWorkerHandle(opts.loaders);
      spawned.push(w);
      return w.handle;
    },
  });
  return { pool, spawned };
}

const BYTES_RESULT: EngineResult = {
  kind: "bytes",
  bytes: new ArrayBuffer(0),
  mime: "image/jpeg",
};

function step(overrides: Partial<RunStep> = {}): RunStep {
  return {
    engine: CANVAS,
    baseUrl: "/engines/canvas@1.0.0/",
    op: "transcode",
    inputFormat: "png",
    outputFormat: "jpg",
    ...overrides,
  };
}

interface BaseReqOverrides {
  jobId?: string;
  input?: EngineInput;
  /** Shorthand for a single-step request on this engine — most tests only
   * care which engine the (one) step runs on. Ignored if `steps` is given. */
  engine?: EngineId;
  /** A full step list, for a test that needs more than one step (or a
   * step's own op/format). Overrides `engine`. */
  steps?: readonly RunStep[];
  options?: Readonly<Record<string, unknown>>;
}

function baseReq(overrides: BaseReqOverrides = {}): RunRequest {
  return {
    jobId: overrides.jobId ?? "job-1",
    input: overrides.input ?? { kind: "bytes", bytes: new ArrayBuffer(0) },
    steps: overrides.steps ?? [step({ engine: overrides.engine ?? CANVAS })],
    options: overrides.options ?? {},
  };
}

describe("createWorkerPool", () => {
  describe("light pool", () => {
    it("spawns workers lazily, capped at size, and queues the rest", () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      const { pool, spawned } = makePool({ loaders, size: 2 });

      // Nothing here cares how these settle, but destroy() below rejects
      // them — attach a handler now so that rejection isn't unhandled.
      const pending = [
        pool.run(baseReq({ jobId: "1" })),
        pool.run(baseReq({ jobId: "2" })),
        pool.run(baseReq({ jobId: "3" })),
      ];
      for (const p of pending) p.catch(() => {});

      // Dispatch to available slots happens synchronously inside run(), so
      // this needs no await: two workers spawned (the size cap), the third
      // job queued behind them.
      expect(spawned.length).toBe(2);
      expect(pool.stats).toEqual({ workers: 2, busy: 2, queued: 1 });

      pool.destroy();
    });

    it("dispatches queued jobs in FIFO order", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      const { pool } = makePool({ loaders, size: 1 });

      const order: string[] = [];
      const p1 = pool
        .run(baseReq({ jobId: "1", options: { tag: "1" } }))
        .then(() => order.push("1"));
      const p2 = pool
        .run(baseReq({ jobId: "2", options: { tag: "2" } }))
        .then(() => order.push("2"));
      const p3 = pool
        .run(baseReq({ jobId: "3", options: { tag: "3" } }))
        .then(() => order.push("3"));

      for (const expectedTag of ["1", "2", "3"]) {
        const run = await tracker.nextStart();
        expect(run.task.options.tag).toBe(expectedTag);
        run.resolve(BYTES_RESULT);
      }

      await Promise.all([p1, p2, p3]);
      expect(order).toEqual(["1", "2", "3"]);

      pool.destroy();
    });

    it("resolves with the EngineResult on ok:true", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      const { pool } = makePool({ loaders, size: 1 });

      const p1 = pool.run(baseReq());
      const run1 = await tracker.nextStart();
      run1.resolve(BYTES_RESULT);

      expect(await p1).toBe(BYTES_RESULT);
      pool.destroy();
    });

    it("rejects with a real EngineError carrying the outcome's code on ok:false", async () => {
      const adapter: EngineAdapter = {
        id: CANVAS,
        version: "1.0.0",
        license: "MIT",
        marker: "localvert-engine:canvas",
        location: "static",
        needsIsolation: false,
        heavy: false,
        supports: () => false, // guarantees an ok:false "unsupported" outcome
        load: async () => ({
          run: async () => {
            throw new Error("unreachable");
          },
          dispose: () => {},
        }),
      };
      const loaders: Loaders = { canvas: async () => ({ default: adapter }) };
      const { pool } = makePool({ loaders, size: 1 });

      const err = await pool.run(baseReq()).catch((e: unknown) => e);
      expect(isEngineError(err)).toBe(true);
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe("unsupported");

      pool.destroy();
    });
  });

  describe("heavy pool", () => {
    it("gives each heavy engine its own worker outside the light pool's size cap", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      loaders[HEAVY_ENGINE] = async () => ({
        default: makeControlledAdapter(HEAVY_ENGINE, true, tracker.onStart),
      });

      const { pool, spawned } = makePool({
        loaders,
        size: 1, // already saturated by a light job below
        isHeavy: (e) => e === HEAVY_ENGINE,
      });

      const pLight = pool.run(baseReq({ jobId: "light" }));
      const runLight = await tracker.nextStart();
      expect(pool.stats).toEqual({ workers: 1, busy: 1, queued: 0 });

      const pHeavy = pool.run(
        baseReq({ jobId: "heavy", engine: HEAVY_ENGINE }),
      );
      const runHeavy = await tracker.nextStart();

      // The heavy job got its own worker immediately, not a slot in the
      // (already full) light pool, and not a place in its queue.
      expect(spawned.length).toBe(2);
      expect(pool.stats).toEqual({ workers: 2, busy: 2, queued: 0 });

      runLight.resolve(BYTES_RESULT);
      runHeavy.resolve(BYTES_RESULT);
      await Promise.all([pLight, pHeavy]);

      pool.destroy();
    });

    it("treats a request as heavy if any step's engine is heavy, even when it isn't the first step", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      loaders[HEAVY_ENGINE] = async () => ({
        default: makeControlledAdapter(HEAVY_ENGINE, true, tracker.onStart),
      });

      const { pool, spawned } = makePool({
        loaders,
        size: 1, // already saturated by a light job below
        isHeavy: (e) => e === HEAVY_ENGINE,
      });

      const pLight = pool.run(baseReq({ jobId: "light" }));
      const runLight = await tracker.nextStart();
      expect(pool.stats).toEqual({ workers: 1, busy: 1, queued: 0 });

      // A two-step request whose *second* step — not the first — is the
      // heavy engine. It must still route to a pinned worker, not queue
      // behind the already-full light pool.
      const pMulti = pool.run(
        baseReq({
          jobId: "multi",
          steps: [
            step({ engine: CANVAS, op: "decode", outputFormat: "raster" }),
            step({ engine: HEAVY_ENGINE, op: "encode", inputFormat: "raster" }),
          ],
        }),
      );
      const runMultiStep0 = await tracker.nextStart();
      expect(spawned.length).toBe(2); // a second worker, for the heavy pinned slot
      expect(pool.stats).toEqual({ workers: 2, busy: 2, queued: 0 });

      runMultiStep0.resolve({
        kind: "raster",
        image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
      });
      const runMultiStep1 = await tracker.nextStart();
      runMultiStep1.resolve(BYTES_RESULT);

      runLight.resolve(BYTES_RESULT);
      await Promise.all([pLight, pMulti]);

      pool.destroy();
    });

    it("pins to the FIRST heavy engine among a request's steps, not a later one", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {};
      loaders[HEAVY_ENGINE] = async () => ({
        default: makeControlledAdapter(HEAVY_ENGINE, true, tracker.onStart),
      });
      loaders[HEAVY_ENGINE_2] = async () => ({
        default: makeControlledAdapter(HEAVY_ENGINE_2, true, tracker.onStart),
      });

      const { pool, spawned } = makePool({
        loaders,
        isHeavy: (e) => e === HEAVY_ENGINE || e === HEAVY_ENGINE_2,
      });

      // A solo request pinned to HEAVY_ENGINE, occupying its worker.
      const p1 = pool.run(
        baseReq({ jobId: "solo-heavy", engine: HEAVY_ENGINE }),
      );
      const run1 = await tracker.nextStart();
      expect(spawned.length).toBe(1);

      // A second request whose steps are [HEAVY_ENGINE, HEAVY_ENGINE_2]. If
      // it pinned to the *second* step's engine, this would spawn a
      // distinct worker; pinning to the first instead means it queues
      // behind p1 on the very same one.
      const p2 = pool.run(
        baseReq({
          jobId: "double-heavy",
          steps: [
            step({ engine: HEAVY_ENGINE }),
            step({ engine: HEAVY_ENGINE_2 }),
          ],
        }),
      );
      expect(spawned.length).toBe(1);
      expect(pool.stats).toEqual({ workers: 1, busy: 1, queued: 1 });

      run1.resolve(BYTES_RESULT);
      await p1;

      const run2Step0 = await tracker.nextStart();
      run2Step0.resolve(BYTES_RESULT);
      const run2Step1 = await tracker.nextStart();
      run2Step1.resolve(BYTES_RESULT);
      await p2;

      pool.destroy();
    });

    it("disposes and terminates a heavy engine's worker after it idles heavyIdleMs, and forgets it", async () => {
      vi.useFakeTimers();
      try {
        const tracker = runTracker();
        const loaders: Loaders = {};
        loaders[HEAVY_ENGINE] = async () => ({
          default: makeControlledAdapter(HEAVY_ENGINE, true, tracker.onStart),
        });
        const { pool, spawned } = makePool({
          loaders,
          isHeavy: (e) => e === HEAVY_ENGINE,
          heavyIdleMs: 60_000,
        });

        const p1 = pool.run(baseReq({ jobId: "h1", engine: HEAVY_ENGINE }));
        const run1 = await tracker.nextStart();
        run1.resolve(BYTES_RESULT);
        await p1;

        // Still pinned and idling — not torn down immediately.
        expect(pool.stats).toEqual({ workers: 1, busy: 0, queued: 0 });
        expect(nth(spawned, 0).terminate).not.toHaveBeenCalled();

        vi.advanceTimersByTime(60_000);
        // dispose() is async even on this fake transport; let its settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(nth(spawned, 0).disposeCalls).toEqual([HEAVY_ENGINE]);
        expect(nth(spawned, 0).terminate).toHaveBeenCalledTimes(1);
        expect(pool.stats).toEqual({ workers: 0, busy: 0, queued: 0 });

        pool.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels a pending idle-teardown when a new job for the same engine arrives", async () => {
      vi.useFakeTimers();
      try {
        const tracker = runTracker();
        const loaders: Loaders = {};
        loaders[HEAVY_ENGINE] = async () => ({
          default: makeControlledAdapter(HEAVY_ENGINE, true, tracker.onStart),
        });
        const { pool, spawned } = makePool({
          loaders,
          isHeavy: (e) => e === HEAVY_ENGINE,
          heavyIdleMs: 60_000,
        });

        const p1 = pool.run(baseReq({ jobId: "h1", engine: HEAVY_ENGINE }));
        const run1 = await tracker.nextStart();
        run1.resolve(BYTES_RESULT);
        await p1;

        vi.advanceTimersByTime(59_000); // shy of the TTL
        const p2 = pool.run(baseReq({ jobId: "h2", engine: HEAVY_ENGINE }));
        const run2 = await tracker.nextStart();

        vi.advanceTimersByTime(59_000); // would have fired if not cancelled
        expect(spawned.length).toBe(1); // same worker reused, not respawned
        expect(nth(spawned, 0).terminate).not.toHaveBeenCalled();

        run2.resolve(BYTES_RESULT);
        await p2;

        pool.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("cancellation", () => {
    it("rejects immediately, without spawning a worker, for an already-aborted signal", async () => {
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, () => {}),
        }),
      };
      const { pool, spawned } = makePool({ loaders, size: 1 });

      const controller = new AbortController();
      controller.abort();

      const err = await pool
        .run(baseReq(), { signal: controller.signal })
        .catch((e: unknown) => e);
      expect((err as EngineError).code).toBe("aborted");
      expect(spawned.length).toBe(0);

      pool.destroy();
    });

    it("removes a still-queued job from the queue on cancel, without touching the running one", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      const { pool } = makePool({ loaders, size: 1 });

      const p1 = pool.run(baseReq({ jobId: "1" }));
      const run1 = await tracker.nextStart();

      const controller = new AbortController();
      const p2 = pool.run(baseReq({ jobId: "2" }), {
        signal: controller.signal,
      });
      expect(pool.stats.queued).toBe(1);

      controller.abort();
      const err = await p2.catch((e: unknown) => e);
      expect((err as EngineError).code).toBe("aborted");
      expect(pool.stats.queued).toBe(0);

      run1.resolve(BYTES_RESULT);
      await p1;
      pool.destroy();
    });

    it("lets a cancelled running job settle naturally when it does so before the grace period", async () => {
      vi.useFakeTimers();
      try {
        const tracker = runTracker();
        const loaders: Loaders = {
          canvas: async () => ({
            default: makeControlledAdapter(CANVAS, false, tracker.onStart),
          }),
        };
        const { pool, spawned } = makePool({
          loaders,
          size: 1,
          cancelGraceMs: 2_000,
        });

        const controller = new AbortController();
        const p1 = pool.run(baseReq({ jobId: "1" }), {
          signal: controller.signal,
        });
        await tracker.nextStart();

        // The controlled adapter honors abort synchronously, so this
        // settles well within the grace period.
        controller.abort();
        const err = await p1.catch((e: unknown) => e);
        expect((err as EngineError).code).toBe("aborted");
        expect(nth(spawned, 0).terminate).not.toHaveBeenCalled();

        // The grace timer was cleared by the natural settlement — letting
        // it "expire" now must not terminate anything.
        vi.advanceTimersByTime(5_000);
        expect(nth(spawned, 0).terminate).not.toHaveBeenCalled();

        pool.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("terminates and lazily replaces the worker if a cancelled job never settles (grace timeout)", async () => {
      vi.useFakeTimers();
      try {
        const tracker = runTracker();
        const loaders: Loaders = {
          canvas: async () => ({
            default: makeStuckAdapter(CANVAS, tracker.onStart),
          }),
        };
        const { pool, spawned } = makePool({
          loaders,
          size: 1,
          cancelGraceMs: 2_000,
        });

        const controller = new AbortController();
        const p1 = pool.run(baseReq({ jobId: "stuck" }), {
          signal: controller.signal,
        });
        await tracker.nextStart();

        controller.abort();
        expect(nth(spawned, 0).terminate).not.toHaveBeenCalled(); // still within grace

        vi.advanceTimersByTime(2_000);
        const err = await p1.catch((e: unknown) => e);
        expect((err as EngineError).code).toBe("aborted");
        expect(nth(spawned, 0).terminate).toHaveBeenCalledTimes(1);
        expect(pool.stats).toEqual({ workers: 0, busy: 0, queued: 0 });

        // Replacement is lazy: only the next job spawns a fresh worker.
        const p2 = pool.run(baseReq({ jobId: "2" }));
        const run2 = await tracker.nextStart();
        expect(spawned.length).toBe(2);
        run2.resolve(BYTES_RESULT);
        await p2;

        pool.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("worker crash", () => {
    it("terminates a crashed worker, rejects the job as internal, and keeps the pool usable", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      const spawned: FakeWorker[] = [];
      let spawnCount = 0;
      const pool = createWorkerPool({
        size: 1,
        isHeavy: () => false,
        spawn: () => {
          spawnCount += 1;
          const w = makeWorkerHandle(loaders, {
            crashOnFirstRun: spawnCount === 1,
          });
          spawned.push(w);
          return w.handle;
        },
      });

      const err = await pool
        .run(baseReq({ jobId: "1" }))
        .catch((e: unknown) => e);
      expect((err as EngineError).code).toBe("internal");
      expect(nth(spawned, 0).terminate).toHaveBeenCalledTimes(1);
      expect(pool.stats).toEqual({ workers: 0, busy: 0, queued: 0 });

      // The pool spawns a fresh worker for the next job and runs normally.
      const p2 = pool.run(baseReq({ jobId: "2" }));
      const run2 = await tracker.nextStart();
      run2.resolve(BYTES_RESULT);
      expect(await p2).toBe(BYTES_RESULT);
      expect(spawned.length).toBe(2);

      pool.destroy();
    });
  });

  describe("destroy", () => {
    it("terminates every worker and rejects queued and running jobs as aborted", async () => {
      const tracker = runTracker();
      const loaders: Loaders = {
        canvas: async () => ({
          default: makeControlledAdapter(CANVAS, false, tracker.onStart),
        }),
      };
      loaders[HEAVY_ENGINE] = async () => ({
        default: makeControlledAdapter(HEAVY_ENGINE, true, tracker.onStart),
      });
      const { pool, spawned } = makePool({
        loaders,
        size: 1,
        isHeavy: (e) => e === HEAVY_ENGINE,
      });

      const pLight = pool.run(baseReq({ jobId: "light" }));
      await tracker.nextStart();

      const pHeavy = pool.run(
        baseReq({ jobId: "heavy", engine: HEAVY_ENGINE }),
      );
      await tracker.nextStart();

      const pQueued = pool.run(baseReq({ jobId: "queued" })); // behind the light worker

      pool.destroy();

      // Promise.allSettled attaches a handler to every promise in the same
      // synchronous tick destroy() rejected them in — awaiting them one at a
      // time here would leave the later ones briefly unhandled and trip
      // Node's unhandledRejection detector.
      const results = await Promise.allSettled([pLight, pHeavy, pQueued]);
      for (const r of results) {
        expect(r.status).toBe("rejected");
        if (r.status === "rejected") {
          expect((r.reason as EngineError).code).toBe("aborted");
        }
      }
      expect(spawned.every((w) => w.terminate.mock.calls.length === 1)).toBe(
        true,
      );

      // A pool call after destroy also rejects, rather than hanging.
      const err = await pool
        .run(baseReq({ jobId: "late" }))
        .catch((e: unknown) => e);
      expect((err as EngineError).code).toBe("aborted");
    });
  });
});
