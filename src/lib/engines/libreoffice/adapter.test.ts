import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineLoadContext, EngineTask } from "../types";
import libreoffice, { checkDeviceMemory, isOutOfMemory } from "./adapter";

/**
 * Node-safe unit coverage only — this mirrors `../ffmpeg/no-bundled-glue
 * .test.ts`'s split: capability matching, the pure memory-guard helpers, and
 * the nested-worker message protocol (driven here by a fake `Worker`) don't
 * need a real wasm heap. A real boot of `browser.worker.global.js` is
 * `e2e/office.spec.ts` territory.
 */
describe("libreoffice adapter", () => {
  it("supports transcoding every accepted office format to pdf only", () => {
    for (const ext of [
      "docx",
      "doc",
      "odt",
      "rtf",
      "xlsx",
      "xls",
      "ods",
      "pptx",
      "ppt",
      "odp",
    ] as const) {
      expect(libreoffice.supports("transcode", ext, "pdf")).toBe(true);
    }
  });

  it("does not support other ops, inputs, or outputs", () => {
    expect(libreoffice.supports("transcode", "docx", "docx")).toBe(false);
    expect(libreoffice.supports("transcode", "png", "pdf")).toBe(false);
    expect(libreoffice.supports("decode", "docx", "pdf")).toBe(false);
  });

  it("declares itself as a heavy, r2-hosted, MPL-2.0, consent-gated engine", () => {
    expect(libreoffice.heavy).toBe(true);
    expect(libreoffice.location).toBe("r2");
    expect(libreoffice.license).toBe("MPL-2.0");
    expect(libreoffice.marker).toBe("localvert-engine:libreoffice");
  });
});

describe("checkDeviceMemory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not throw when deviceMemory is unreported", () => {
    vi.stubGlobal("navigator", {});
    expect(() => checkDeviceMemory()).not.toThrow();
  });

  it("does not throw when deviceMemory meets the 4 GiB floor", () => {
    vi.stubGlobal("navigator", { deviceMemory: 8 });
    expect(() => checkDeviceMemory()).not.toThrow();
    vi.stubGlobal("navigator", { deviceMemory: 4 });
    expect(() => checkDeviceMemory()).not.toThrow();
  });

  it("throws unsupported when deviceMemory is below 4 GiB", () => {
    vi.stubGlobal("navigator", { deviceMemory: 2 });
    expect(() => checkDeviceMemory()).toThrow(/at least 4 GB of memory/);
  });
});

describe("isOutOfMemory", () => {
  it("recognizes a RangeError", () => {
    expect(isOutOfMemory(new RangeError("Maximum call stack"))).toBe(true);
  });

  it("recognizes an 'out of memory' message", () => {
    expect(
      isOutOfMemory(
        new Error(
          "abort(OOM). Build with -sASSERTIONS for more info. out of memory",
        ),
      ),
    ).toBe(true);
  });

  it("is false for an unrelated error", () => {
    expect(isOutOfMemory(new Error("network error"))).toBe(false);
    expect(isOutOfMemory("plain string")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fake nested-worker protocol
// ---------------------------------------------------------------------------

type Listener = (event: { data?: unknown; message?: string }) => void;

/** A minimal fake `Worker`: records every `postMessage` call and lets the
 * test drive `message`/`error` events by hand — enough to exercise this
 * adapter's init handshake and convert request/response without a real
 * nested worker or wasm heap. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  terminated = false;
  private listeners: Record<string, Listener[]> = { message: [], error: [] };

  constructor(public url: string) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: "message" | "error", fn: Listener): void {
    this.listeners[type]?.push(fn);
  }

  removeEventListener(type: "message" | "error", fn: Listener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }

  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    for (const fn of this.listeners.message ?? []) fn({ data });
  }

  emitError(message: string): void {
    for (const fn of this.listeners.error ?? []) fn({ message });
  }
}

function gzipResponse(text: string): Response {
  return new Response(gzipSync(Buffer.from(text)));
}

/** Waits for `predicate()` to become true, polling on microtask/macrotask
 * boundaries — used to let the adapter's pending promises (fetch, init)
 * advance before this test drives the next fake-worker event. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("waitFor: condition never became true");
}

const ctx: EngineLoadContext = {
  baseUrl: "/engines/xl/libreoffice@2.3.1/",
  capabilities: {
    crossOriginIsolated: true,
    sharedArrayBuffer: true,
    webCodecs: false,
    offscreenCanvas: false,
    webgl2: false,
  } as unknown as EngineLoadContext["capabilities"],
};

function makeTask(overrides: Partial<EngineTask> = {}): EngineTask {
  const controller = new AbortController();
  return {
    op: "transcode",
    input: { kind: "bytes", bytes: new Uint8Array([1, 2, 3]).buffer },
    inputFormat: "docx",
    outputFormat: "pdf",
    options: {},
    signal: controller.signal,
    ...overrides,
  };
}

describe("libreoffice adapter message protocol (fake worker)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.instances = [];
  });

  it("initializes the nested worker once, then reuses it across conversions", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gzipResponse("fake-wasm-or-data-bytes")),
    );

    const instance = await libreoffice.load(ctx);

    const first = instance.run(makeTask());
    await waitFor(() => FakeWorker.instances.length === 1);
    const worker = FakeWorker.instances[0] as FakeWorker;
    await waitFor(() => worker.posted.length === 1);
    expect((worker.posted[0] as { type: string }).type).toBe("init");
    worker.emitMessage({ type: "ready", id: "init" });

    await waitFor(() => worker.posted.length === 2);
    const convertMsg = worker.posted[1] as { type: string; id: string };
    expect(convertMsg.type).toBe("convert");
    worker.emitMessage({
      type: "result",
      id: convertMsg.id,
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });

    const result = await first;
    expect(result.kind).toBe("bytes");
    if (result.kind === "bytes") {
      expect(result.mime).toBe("application/pdf");
      expect(new Uint8Array(result.bytes)).toEqual(
        new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      );
    }

    // A second job must not spawn a second nested worker.
    const second = instance.run(makeTask());
    await waitFor(() => worker.posted.length === 3);
    const convertMsg2 = worker.posted[2] as { type: string; id: string };
    worker.emitMessage({
      type: "result",
      id: convertMsg2.id,
      data: new Uint8Array([1]),
    });
    await second;
    expect(FakeWorker.instances.length).toBe(1);
  });

  it("rejects with an encode-failed EngineError on a worker error message", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gzipResponse("fake bytes")),
    );

    const instance = await libreoffice.load(ctx);
    const runPromise = instance.run(makeTask());
    await waitFor(() => FakeWorker.instances.length === 1);
    const worker = FakeWorker.instances[0] as FakeWorker;
    worker.emitMessage({ type: "ready", id: "init" });
    await waitFor(() => worker.posted.length === 2);
    const convertMsg = worker.posted[1] as { id: string };
    worker.emitMessage({
      type: "error",
      id: convertMsg.id,
      error: "Failed to load document: bad zip",
    });

    await expect(runPromise).rejects.toMatchObject({
      name: "EngineError",
      code: "encode-failed",
    });
  });

  it("terminates the nested worker and rejects when the task is aborted", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gzipResponse("fake bytes")),
    );

    const instance = await libreoffice.load(ctx);
    const controller = new AbortController();
    const runPromise = instance.run(makeTask({ signal: controller.signal }));
    await waitFor(() => FakeWorker.instances.length === 1);
    const worker = FakeWorker.instances[0] as FakeWorker;
    worker.emitMessage({ type: "ready", id: "init" });
    await waitFor(() => worker.posted.length === 2);

    controller.abort();

    await expect(runPromise).rejects.toMatchObject({
      name: "EngineError",
      code: "aborted",
    });
    expect(worker.terminated).toBe(true);
  });

  it("rejects with unsupported when the device reports too little memory", async () => {
    vi.stubGlobal("navigator", { deviceMemory: 2 });
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gzipResponse("fake bytes")),
    );

    const instance = await libreoffice.load(ctx);
    await expect(instance.run(makeTask())).rejects.toMatchObject({
      name: "EngineError",
      code: "unsupported",
    });
    expect(FakeWorker.instances.length).toBe(0);
  });
});
