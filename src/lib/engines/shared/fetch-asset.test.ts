import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchAssetHttpError, fetchAsset } from "./fetch-asset";

/** A `Response`-shaped object whose body never delivers a chunk until the
 * fetch's own `signal` aborts, at which point the pending read rejects —
 * models a connection that stops delivering bytes mid-download, the way a
 * flaky network or an overloaded dev server does. */
function stallingResponse(signal: AbortSignal): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: () =>
          new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("stalled", "AbortError")),
              { once: true },
            );
          }),
      }),
    },
  } as unknown as Response;
}

/** A `Response`-shaped object that delivers `chunks` one read() at a time,
 * then `done`. */
function chunkedResponse(
  chunks: readonly Uint8Array[],
  total?: number,
): Response {
  const queue = [...chunks];
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name === "content-length" && total !== undefined ? String(total) : null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          const value = queue.shift();
          if (value === undefined) return { done: true, value: undefined };
          return { done: false, value };
        },
      }),
    },
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    body: null,
  } as unknown as Response;
}

describe("fetchAsset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads a body stream chunk by chunk and reports progress", async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
    const fetchMock = vi.fn(async () => chunkedResponse(chunks, 5));
    vi.stubGlobal("fetch", fetchMock);

    const progress: [number, number | undefined][] = [];
    const bytes = await fetchAsset("https://x.test/asset.bin", {
      engine: "typst",
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });

    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(progress).toEqual([
      [2, 5],
      [5, 5],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("works with a real Response body (undici/browser)", async () => {
    const payload = new Uint8Array([9, 8, 7]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(payload)),
    );
    const bytes = await fetchAsset("https://x.test/real.bin", {
      engine: "typst",
    });
    expect(bytes).toEqual(payload);
  });

  it("throws FetchAssetHttpError immediately on a non-OK status, no retry", async () => {
    const fetchMock = vi.fn(async () => errorResponse(404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAsset("https://x.test/missing.bin", { engine: "typst" }),
    ).rejects.toThrow(FetchAssetHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respects an already-aborted caller signal, no fetch attempted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const fetchMock = vi.fn(async () => chunkedResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAsset("https://x.test/asset.bin", {
        engine: "typst",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stalls once then succeeds on retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const chunks = [new Uint8Array([1, 2, 3])];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async (_url: string, init: { signal: AbortSignal }) =>
          stallingResponse(init.signal),
      )
      .mockImplementationOnce(async () => chunkedResponse(chunks, 3));
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchAsset("https://x.test/asset.bin", {
      engine: "typst",
      stallMs: 1_000,
      retries: 1,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    const bytes = await promise;

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up with a clear EngineError after stalling on every attempt", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(
      async (_url: string, init: { signal: AbortSignal }) =>
        stallingResponse(init.signal),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchAsset("https://x.test/asset.bin", {
      engine: "typst",
      stallMs: 1_000,
      retries: 1,
    });
    const rejection = expect(promise).rejects.toMatchObject({
      name: "EngineError",
      code: "load-failed",
      message: expect.stringMatching(/download stalled/i),
    });

    await vi.advanceTimersByTimeAsync(1_000); // attempt 1 stalls
    await vi.advanceTimersByTimeAsync(1_000); // attempt 2 (the retry) stalls too
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
