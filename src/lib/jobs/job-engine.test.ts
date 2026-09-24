import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { EngineResult } from "@/lib/engines";
import { EngineError } from "@/lib/engines";
import type { ToolDefinition } from "@/lib/registry";
import type {
  RunOptions,
  RunRequest,
  WorkerPool,
  ZipResult,
} from "@/lib/workers";
import { makeCaps } from "@/test/caps";
import type { JobEngineOptions } from "./job-engine";
import { createJobEngine } from "./job-engine";
import { createJobStore } from "./store";

/**
 * Fake `WorkerPool.run`: hands each call back a controllable deferred, so a
 * test decides exactly when (and how) a job settles, and mirrors real
 * `pool.ts` cancellation semantics closely enough for the job engine's own
 * cancel handling to be exercised — a signal aborting rejects with an
 * `EngineError("aborted", ...)`, same as the real pool.
 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeRun {
  req: RunRequest;
  opts: RunOptions;
  deferred: Deferred<EngineResult>;
}

function createFakePool() {
  const calls: FakeRun[] = [];
  const pool: WorkerPool = {
    run(req, opts = {}) {
      const d = deferred<EngineResult>();
      calls.push({ req, opts, deferred: d });
      if (opts.signal) {
        if (opts.signal.aborted) {
          d.reject(
            new EngineError("aborted", "cancelled before dispatch", {
              engine: req.engine,
            }),
          );
        } else {
          opts.signal.addEventListener(
            "abort",
            () => {
              d.reject(
                new EngineError("aborted", "cancelled", { engine: req.engine }),
              );
            },
            { once: true },
          );
        }
      }
      return d.promise;
    },
    stats: { workers: 0, busy: 0, queued: 0 },
    destroy: vi.fn(),
  };
  return { pool, calls };
}

/** Waits out every pending microtask so store updates chained behind a
 * resolved/rejected deferred have landed. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    slug: "jpg-to-png",
    category: "image",
    title: "JPG to PNG",
    description: "Convert JPG images to PNG in your browser.",
    accepts: ["jpg"],
    produces: "png",
    options: z.object({}),
    defaults: {},
    pipeline: [{ op: "transcode", candidates: [{ engine: "canvas" }] }],
    batch: true,
    ...overrides,
  };
}

function makeFile(name = "photo.jpg"): File {
  return new File(["hello"], name, { type: "image/jpeg" });
}

function bytesResult(text: string, mime = "image/png"): EngineResult {
  return { kind: "bytes", bytes: new TextEncoder().encode(text).buffer, mime };
}

function setup(overrides: Partial<JobEngineOptions> = {}) {
  const { pool, calls } = createFakePool();
  const store = createJobStore();
  let urlCounter = 0;
  const createObjectURL = vi.fn(() => `blob:fake-${urlCounter++}`);
  const zipCalls: { name: string; blob: Blob }[][] = [];
  const zip = vi.fn(async (entries: { name: string; blob: Blob }[]) => {
    zipCalls.push(entries);
    return {
      stream: new ReadableStream(),
      dispose: vi.fn(),
    } satisfies ZipResult;
  });

  const engine = createJobEngine({
    pool,
    capabilities: makeCaps(),
    store,
    createObjectURL,
    zip,
    ...overrides,
  });

  return { engine, pool, calls, store, createObjectURL, zip, zipCalls };
}

describe("createJobEngine / submit", () => {
  it("progresses queued -> running -> done with an output name and url", async () => {
    const { engine, calls, store, createObjectURL } = setup();

    const ids = engine.submit(
      makeTool(),
      [{ file: makeFile(), format: "jpg" }],
      {},
    );
    expect(ids).toHaveLength(1);
    const id = ids[0];
    if (!id) throw new Error("expected a job id");

    // A "pool"-category job is dispatched synchronously within submit().
    expect(calls).toHaveLength(1);
    expect(store.getState().jobs[0]).toMatchObject({ id, status: "running" });

    calls[0]?.deferred.resolve(bytesResult("out"));
    await flush();

    const job = store.getState().jobs[0];
    expect(job).toMatchObject({ status: "done", progress: 1 });
    expect(job?.output?.name).toBe("photo.png");
    expect(job?.output?.mime).toBe("image/png");
    expect(job?.output?.url).toBe("blob:fake-0");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("forwards progress callbacks to the store", () => {
    const { engine, calls, store } = setup();
    const ids = engine.submit(
      makeTool(),
      [{ file: makeFile(), format: "jpg" }],
      {},
    );
    const id = ids[0];

    calls[0]?.opts.onProgress?.(0.3);
    expect(store.getState().jobs.find((j) => j.id === id)?.progress).toBe(0.3);

    calls[0]?.opts.onProgress?.(0.7);
    expect(store.getState().jobs.find((j) => j.id === id)?.progress).toBe(0.7);
  });

  it("throws on invalid options before creating any job", () => {
    const { engine, calls, store } = setup();
    const tool = makeTool({
      options: z.object({ quality: z.number().min(1).max(100) }),
      defaults: { quality: 90 },
    });

    expect(() =>
      engine.submit(tool, [{ file: makeFile(), format: "jpg" }], {
        quality: "not a number",
      }),
    ).toThrow(/^\[job\] invalid options:/);

    expect(store.getState().jobs).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("throws before creating any job when the pipeline has more than one step", () => {
    const { engine, calls, store } = setup();
    const tool = makeTool({
      pipeline: [
        { op: "transcode", candidates: [{ engine: "canvas" }] },
        { op: "compress", candidates: [{ engine: "canvas" }] },
      ],
    });

    expect(() =>
      engine.submit(tool, [{ file: makeFile(), format: "jpg" }], {}),
    ).toThrow(/multi-step pipelines are not supported yet/);

    expect(store.getState().jobs).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("marks every job as error/unsupported when no engine candidate is eligible", () => {
    const { engine, calls, store } = setup();
    const tool = makeTool({
      pipeline: [
        {
          op: "transcode",
          candidates: [{ engine: "canvas", when: () => false }],
        },
      ],
    });

    const ids = engine.submit(
      tool,
      [
        { file: makeFile("a.jpg"), format: "jpg" },
        { file: makeFile("b.jpg"), format: "jpg" },
      ],
      {},
    );

    expect(ids).toHaveLength(2);
    expect(calls).toHaveLength(0);
    for (const job of store.getState().jobs) {
      expect(job.status).toBe("error");
      expect(job.error?.code).toBe("unsupported");
    }
  });

  it("maps an EngineError from the pool to an error job", async () => {
    const { engine, calls, store } = setup();
    engine.submit(makeTool(), [{ file: makeFile(), format: "jpg" }], {});

    calls[0]?.deferred.reject(
      new EngineError("decode-failed", "bad image", { engine: "canvas" }),
    );
    await flush();

    const job = store.getState().jobs[0];
    expect(job?.status).toBe("error");
    expect(job?.error).toEqual({ code: "decode-failed", message: "bad image" });
  });

  it("maps an aborted EngineError from the pool to a cancelled job", async () => {
    const { engine, calls, store } = setup();
    const ids = engine.submit(
      makeTool(),
      [{ file: makeFile(), format: "jpg" }],
      {},
    );
    const id = ids[0];

    engine.cancel(id ?? "");
    await flush();

    const job = store.getState().jobs[0];
    expect(job?.status).toBe("cancelled");
    expect(job?.error?.code).toBe("aborted");
    expect(calls[0]?.opts.signal?.aborted).toBe(true);
  });

  it("cancelling a still-queued 'single'-category job never reaches the pool", async () => {
    const { engine, calls, store } = setup();
    const tool = makeTool({ category: "document" }); // "single" concurrency

    const ids = engine.submit(
      tool,
      [
        { file: makeFile("a.jpg"), format: "jpg" },
        { file: makeFile("b.jpg"), format: "jpg" },
      ],
      {},
    );
    const [id1, id2] = ids;
    if (!id1 || !id2) throw new Error("expected two job ids");

    // The category's FIFO chain dispatches its first job on a microtask,
    // not synchronously within submit() — only the first job is dispatched;
    // the second waits behind it, not yet even running its own executor.
    await flush();
    expect(calls).toHaveLength(1);

    // Cancelling id2 here only aborts its controller — id2's own executor
    // hasn't run yet (it's still chained behind id1), so it can't observe
    // that until id1 settles and the chain advances to it.
    engine.cancel(id2);
    expect(store.getState().jobs.find((j) => j.id === id2)?.status).toBe(
      "queued",
    );

    calls[0]?.deferred.resolve(bytesResult("a"));
    await flush();

    expect(store.getState().jobs.find((j) => j.id === id1)?.status).toBe(
      "done",
    );
    expect(store.getState().jobs.find((j) => j.id === id2)?.status).toBe(
      "cancelled",
    );
    expect(calls).toHaveLength(1); // id2 never reached the pool
  });

  it("runs a 'single'-concurrency category sequentially, one job in flight at a time", async () => {
    const { engine, calls } = setup();
    const tool = makeTool({ category: "document" });

    engine.submit(
      tool,
      [
        { file: makeFile("a.jpg"), format: "jpg" },
        { file: makeFile("b.jpg"), format: "jpg" },
      ],
      {},
    );

    await flush();
    expect(calls).toHaveLength(1);

    calls[0]?.deferred.resolve(bytesResult("a"));
    await flush();

    expect(calls).toHaveLength(2);
  });

  it("dispatches every job in a 'pool'-concurrency category immediately", () => {
    const { engine, calls } = setup();
    const tool = makeTool({ category: "image" });

    engine.submit(
      tool,
      [
        { file: makeFile("a.jpg"), format: "jpg" },
        { file: makeFile("b.jpg"), format: "jpg" },
      ],
      {},
    );

    expect(calls).toHaveLength(2);
  });
});

describe("createJobEngine / zipOutputs", () => {
  it("passes only the requested done jobs' blobs and names to the injected zip", async () => {
    const { engine, calls, zip, zipCalls } = setup();
    const ids = engine.submit(
      makeTool(),
      [
        { file: makeFile("a.jpg"), format: "jpg" },
        { file: makeFile("b.jpg"), format: "jpg" },
      ],
      {},
    );
    const [idA, idB] = ids;
    if (!idA || !idB) throw new Error("expected two job ids");

    calls[0]?.deferred.resolve(bytesResult("A-bytes"));
    calls[1]?.deferred.resolve(bytesResult("B-bytes"));
    await flush();

    const stream = await engine.zipOutputs([idA]);
    expect(zip).toHaveBeenCalledTimes(1);
    expect(zipCalls[0]).toHaveLength(1);
    expect(zipCalls[0]?.[0]?.name).toBe("a.png");
    expect(await zipCalls[0]?.[0]?.blob.text()).toBe("A-bytes");
    expect(stream).toBeInstanceOf(ReadableStream);

    await engine.zipOutputs();
    expect(zipCalls[1]).toHaveLength(2);
    expect(zipCalls[1]?.map((e) => e.name).sort()).toEqual(["a.png", "b.png"]);
  });
});

describe("createJobEngine / dispose", () => {
  it("cancels every in-flight job", async () => {
    const { engine, calls, store } = setup();
    engine.submit(makeTool(), [{ file: makeFile(), format: "jpg" }], {});

    engine.dispose();
    await flush();

    expect(calls[0]?.opts.signal?.aborted).toBe(true);
    expect(store.getState().jobs[0]?.status).toBe("cancelled");
  });
});
