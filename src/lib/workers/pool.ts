import type { EngineResult } from "@/lib/engines";
import { EngineError } from "@/lib/engines";
import type { EngineId } from "@/lib/registry";
import type { EngineHostApi, Promisified, RunRequest } from "./protocol";
import { deserializeEngineError } from "./protocol";

/**
 * MAIN THREAD. Owns the worker lifecycle: lazy spawn, FIFO dispatch, a
 * pinned worker with an idle TTL per heavy engine, and cancellation — see
 * docs/ARCHITECTURE.md "Concurrency and memory". `spawn` is injected rather
 * than this module constructing a `Worker` itself, so the real `new
 * Worker(...) + Comlink.wrap(...)` factory (Phase 0.5) and this scheduling
 * logic can be tested independently of each other.
 */

export interface WorkerHandle {
  api: Promisified<EngineHostApi>;
  terminate(): void;
}

export interface PoolOptions {
  /** Cap on shared light-engine workers. Heavy engines get a worker each,
   * outside this cap — see `isHeavy`. */
  size: number;
  spawn: () => WorkerHandle;
  isHeavy: (engine: EngineId) => boolean;
  /** How long a heavy engine's pinned worker sits idle before it is
   * disposed and terminated. Default 60_000. */
  heavyIdleMs?: number;
  /** How long a cancelled-but-running job gets to settle on its own before
   * its worker is terminated outright. Default 2_000. */
  cancelGraceMs?: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface WorkerPool {
  run(req: RunRequest, opts?: RunOptions): Promise<EngineResult>;
  readonly stats: { workers: number; busy: number; queued: number };
  destroy(): void;
}

type JobState = "queued" | "running" | "settled";

interface Job {
  req: RunRequest;
  opts: RunOptions;
  resolve: (result: EngineResult) => void;
  reject: (err: unknown) => void;
  state: JobState;
  removeAbortListener?: () => void;
  cancelGraceTimer?: ReturnType<typeof setTimeout>;
}

interface LightSlot {
  handle: WorkerHandle;
  currentJob: Job | null;
}

interface HeavySlot {
  handle: WorkerHandle;
  queue: Job[];
  running: Job | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function createWorkerPool(o: PoolOptions): WorkerPool {
  const heavyIdleMs = o.heavyIdleMs ?? 60_000;
  const cancelGraceMs = o.cancelGraceMs ?? 2_000;

  const lightSlots: LightSlot[] = [];
  const lightQueue: Job[] = [];
  const heavySlots = new Map<EngineId, HeavySlot>();

  let destroyed = false;

  /** Settles `job` exactly once: clears its abort listener and any pending
   * cancel-grace timer, then runs `fn` (a `resolve`/`reject` call). Every
   * settlement path — normal completion, crash, cancellation — goes through
   * this so a job can never resolve and later also reject, or vice versa. */
  function settle(job: Job, fn: () => void): void {
    if (job.state === "settled") return;
    job.state = "settled";
    job.removeAbortListener?.();
    if (job.cancelGraceTimer !== undefined) {
      clearTimeout(job.cancelGraceTimer);
      job.cancelGraceTimer = undefined;
    }
    fn();
  }

  // ---- light (shared) pool -------------------------------------------

  function pumpLight(): void {
    while (lightQueue.length > 0) {
      let slot = lightSlots.find((s) => s.currentJob === null);
      if (!slot && lightSlots.length < o.size) {
        slot = { handle: o.spawn(), currentJob: null };
        lightSlots.push(slot);
      }
      if (!slot) return; // every slot busy, at capacity

      const job = lightQueue.shift();
      if (!job) return;
      dispatchLight(slot, job);
    }
  }

  function removeLightSlot(slot: LightSlot): void {
    const idx = lightSlots.indexOf(slot);
    if (idx !== -1) lightSlots.splice(idx, 1);
  }

  /** Reads `job.state` through a `JobState`-typed return so a caller that
   * assigned the property earlier in the same function (before an `await`)
   * doesn't get it back over-narrowed to that one literal — `settle()` may
   * have changed it in the meantime, via a `cancelJob` racing the same
   * `await`, and TS's control-flow analysis has no way to know that. */
  function stateOf(job: Job): JobState {
    return job.state;
  }

  async function dispatchLight(slot: LightSlot, job: Job): Promise<void> {
    slot.currentJob = job;
    job.state = "running";

    let outcome: Awaited<ReturnType<Promisified<EngineHostApi>["run"]>>;
    try {
      outcome = await slot.handle.api.run(job.req, job.opts.onProgress);
    } catch (crashErr) {
      // The worker died (or its RPC channel did) rather than answering with
      // a RunOutcome. Terminate it and keep the pool usable.
      removeLightSlot(slot);
      slot.handle.terminate();
      if (stateOf(job) !== "settled") {
        settle(job, () =>
          job.reject(
            new EngineError("internal", "worker crashed", {
              engine: job.req.engine,
              cause: crashErr,
            }),
          ),
        );
      }
      pumpLight();
      return;
    }

    // A grace-timeout or destroy() may have already removed this slot and
    // settled the job while the call above was in flight — a late outcome
    // arriving from a worker we've since terminated is stale.
    if (lightSlots.indexOf(slot) === -1) return;

    slot.currentJob = null;

    if (stateOf(job) !== "settled") {
      if (outcome.ok) {
        settle(job, () => job.resolve(outcome.result));
      } else {
        settle(job, () => job.reject(deserializeEngineError(outcome.error)));
      }
    }

    pumpLight();
  }

  // ---- heavy (pinned, one worker per engine) ---------------------------

  function enqueueHeavy(job: Job): void {
    const engine = job.req.engine;
    let slot = heavySlots.get(engine);
    if (!slot) {
      slot = { handle: o.spawn(), queue: [], running: null, idleTimer: null };
      heavySlots.set(engine, slot);
    } else if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }
    slot.queue.push(job);
    pumpHeavy(engine);
  }

  function pumpHeavy(engine: EngineId): void {
    const slot = heavySlots.get(engine);
    if (!slot || slot.running !== null) return;
    const job = slot.queue.shift();
    if (!job) return;
    slot.running = job;
    job.state = "running";
    dispatchHeavy(engine, slot, job);
  }

  function removeHeavySlot(engine: EngineId, slot: HeavySlot): void {
    if (heavySlots.get(engine) !== slot) return; // already replaced
    heavySlots.delete(engine);
    if (slot.idleTimer !== null) clearTimeout(slot.idleTimer);
  }

  /** Jobs still waiting behind a terminated pinned worker need a fresh one
   * now — there is live demand, so this is the one case where a heavy
   * worker is spawned eagerly rather than on the next `run()` call. */
  function requeueHeavy(engine: EngineId, pending: Job[]): void {
    if (pending.length === 0) return;
    const slot: HeavySlot = {
      handle: o.spawn(),
      queue: pending,
      running: null,
      idleTimer: null,
    };
    heavySlots.set(engine, slot);
    pumpHeavy(engine);
  }

  function scheduleHeavyIdle(engine: EngineId, slot: HeavySlot): void {
    if (slot.queue.length > 0) return; // more work already waiting
    slot.idleTimer = setTimeout(() => {
      heavySlots.delete(engine);
      // Terminating the worker is the only reliable way to reclaim an
      // Emscripten heap — `dispose()` alone leaks (see ARCHITECTURE.md
      // "Concurrency and memory"). dispose() is given a chance first so the
      // adapter can free what it can on its own terms, but termination
      // happens regardless of whether that call succeeds.
      slot.handle.api
        .dispose(engine)
        .catch(() => {})
        .finally(() => slot.handle.terminate());
    }, heavyIdleMs);
  }

  async function dispatchHeavy(
    engine: EngineId,
    slot: HeavySlot,
    job: Job,
  ): Promise<void> {
    let outcome: Awaited<ReturnType<Promisified<EngineHostApi>["run"]>>;
    try {
      outcome = await slot.handle.api.run(job.req, job.opts.onProgress);
    } catch (crashErr) {
      removeHeavySlot(engine, slot);
      slot.handle.terminate();
      if (job.state !== "settled") {
        settle(job, () =>
          job.reject(
            new EngineError("internal", "worker crashed", {
              engine,
              cause: crashErr,
            }),
          ),
        );
      }
      requeueHeavy(engine, slot.queue.splice(0));
      return;
    }

    if (heavySlots.get(engine) !== slot) return; // replaced mid-flight

    slot.running = null;

    if (job.state !== "settled") {
      if (outcome.ok) {
        settle(job, () => job.resolve(outcome.result));
      } else {
        settle(job, () => job.reject(deserializeEngineError(outcome.error)));
      }
    }

    scheduleHeavyIdle(engine, slot);
    pumpHeavy(engine);
  }

  // ---- cancellation ------------------------------------------------

  function beginCancelGrace(
    job: Job,
    handle: WorkerHandle,
    onGraceExpired: () => void,
  ): void {
    // Fire-and-forget: whether this resolves or rejects, the grace timer
    // below is what actually decides if cancellation happened in time.
    handle.api.cancel(job.req.jobId).catch(() => {});
    job.cancelGraceTimer = setTimeout(() => {
      if (job.state === "settled") return;
      // A synchronous wasm encode loop can't observe an abort signal until
      // it next yields, which it may never do on its own — terminating the
      // worker is the only way out at that point.
      onGraceExpired();
    }, cancelGraceMs);
  }

  function cancelJob(job: Job): void {
    if (job.state === "settled") return;

    if (job.state === "queued") {
      const qi = lightQueue.indexOf(job);
      if (qi !== -1) {
        lightQueue.splice(qi, 1);
        settle(job, () =>
          job.reject(
            new EngineError("aborted", "cancelled while queued", {
              engine: job.req.engine,
            }),
          ),
        );
        return;
      }
      const heavySlot = heavySlots.get(job.req.engine);
      if (heavySlot) {
        const hi = heavySlot.queue.indexOf(job);
        if (hi !== -1) {
          heavySlot.queue.splice(hi, 1);
          settle(job, () =>
            job.reject(
              new EngineError("aborted", "cancelled while queued", {
                engine: job.req.engine,
              }),
            ),
          );
        }
      }
      return;
    }

    // running
    const lightSlot = lightSlots.find((s) => s.currentJob === job);
    if (lightSlot) {
      beginCancelGrace(job, lightSlot.handle, () => {
        removeLightSlot(lightSlot);
        lightSlot.handle.terminate();
        settle(job, () =>
          job.reject(
            new EngineError("aborted", "cancelled (grace timeout)", {
              engine: job.req.engine,
            }),
          ),
        );
        pumpLight();
      });
      return;
    }

    const heavySlot = heavySlots.get(job.req.engine);
    if (heavySlot && heavySlot.running === job) {
      const engine = job.req.engine;
      beginCancelGrace(job, heavySlot.handle, () => {
        removeHeavySlot(engine, heavySlot);
        heavySlot.handle.terminate();
        settle(job, () =>
          job.reject(
            new EngineError("aborted", "cancelled (grace timeout)", {
              engine,
            }),
          ),
        );
        requeueHeavy(engine, heavySlot.queue.splice(0));
      });
    }
  }

  // ---- public API ----------------------------------------------------

  function run(req: RunRequest, opts: RunOptions = {}): Promise<EngineResult> {
    if (destroyed) {
      return Promise.reject(
        new EngineError("aborted", "pool destroyed", { engine: req.engine }),
      );
    }
    if (opts.signal?.aborted) {
      return Promise.reject(
        new EngineError("aborted", "cancelled before dispatch", {
          engine: req.engine,
        }),
      );
    }

    return new Promise<EngineResult>((resolve, reject) => {
      const job: Job = { req, opts, resolve, reject, state: "queued" };

      const signal = opts.signal;
      if (signal) {
        const onAbort = () => cancelJob(job);
        signal.addEventListener("abort", onAbort, { once: true });
        job.removeAbortListener = () =>
          signal.removeEventListener("abort", onAbort);
      }

      if (o.isHeavy(req.engine)) {
        enqueueHeavy(job);
      } else {
        lightQueue.push(job);
        pumpLight();
      }
    });
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    for (const job of lightQueue.splice(0)) {
      settle(job, () =>
        job.reject(
          new EngineError("aborted", "pool destroyed", {
            engine: job.req.engine,
          }),
        ),
      );
    }
    for (const slot of lightSlots.splice(0)) {
      slot.handle.terminate();
      const running = slot.currentJob;
      if (running && running.state !== "settled") {
        settle(running, () =>
          running.reject(
            new EngineError("aborted", "pool destroyed", {
              engine: running.req.engine,
            }),
          ),
        );
      }
    }

    for (const [engine, slot] of heavySlots) {
      if (slot.idleTimer !== null) clearTimeout(slot.idleTimer);
      slot.handle.terminate();
      for (const job of slot.queue.splice(0)) {
        settle(job, () =>
          job.reject(new EngineError("aborted", "pool destroyed", { engine })),
        );
      }
      const running = slot.running;
      if (running && running.state !== "settled") {
        settle(running, () =>
          running.reject(
            new EngineError("aborted", "pool destroyed", { engine }),
          ),
        );
      }
    }
    heavySlots.clear();
  }

  return {
    run,
    get stats() {
      let heavyBusy = 0;
      let heavyQueued = 0;
      for (const slot of heavySlots.values()) {
        if (slot.running) heavyBusy += 1;
        heavyQueued += slot.queue.length;
      }
      return {
        workers: lightSlots.length + heavySlots.size,
        busy:
          lightSlots.filter((s) => s.currentJob !== null).length + heavyBusy,
        queued: lightQueue.length + heavyQueued,
      };
    },
    destroy,
  };
}
