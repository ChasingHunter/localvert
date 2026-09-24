import { describe, expect, it, vi } from "vitest";
import { handle } from "./index";

/** Minimal stand-in for what `R2Bucket.get` resolves to — only the fields `handle()` reads. */
type FakeR2Object = {
  httpEtag: string;
  size: number;
  body?: ReadableStream;
  range?: R2Range;
  httpMetadata?: R2HTTPMetadata;
  writeHttpMetadata?: (headers: Headers) => void;
};

function streamOf(text: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/**
 * Fake `env`: only the two members `handle()` touches, per the contract —
 * `ASSETS.fetch` and `ENGINES.get`. Cast through `unknown` deliberately;
 * matching the full `R2Bucket`/`Fetcher` interfaces would just be noise no
 * test here reads.
 */
function fakeEnv(options?: {
  assetsFetch?: (request: Request) => Promise<Response>;
  get?: (key: string) => Promise<FakeR2Object | null>;
}) {
  const assetsFetch = vi.fn(
    options?.assetsFetch ??
      (async () => new Response("not found", { status: 404 })),
  );
  const get = vi.fn(options?.get ?? (async () => null));
  const env = {
    ASSETS: { fetch: assetsFetch },
    ENGINES: { get },
  } as unknown as Env;
  return { env, assetsFetch, get };
}

/** Map-backed `Cache`, keyed on request URL, matching the real Cache API's shape. */
function fakeCache(): Cache {
  const store = new Map<string, Response>();
  return {
    async match(request: Request) {
      return store.get(request.url);
    },
    async put(request: Request, response: Response) {
      store.set(request.url, response);
    },
    async delete() {
      return false;
    },
  } as unknown as Cache;
}

function fakeCtx() {
  const waited: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      waited.push(promise);
    },
  } as unknown as ExecutionContext;
  return { ctx, waited };
}

const ENGINE_PATH = "/engines/xl/ffmpeg-core@1.0.0/ffmpeg-core.wasm";
const ENGINE_KEY = "xl/ffmpeg-core@1.0.0/ffmpeg-core.wasm";

describe("handle", () => {
  it("delegates a non-xl path straight to ASSETS", async () => {
    const assetsResponse = new Response("asset body");
    const { env, assetsFetch } = fakeEnv({
      assetsFetch: async () => assetsResponse,
    });
    const { ctx } = fakeCtx();
    const request = new Request("http://localhost/index.html");

    const response = await handle(request, env, ctx, fakeCache());

    expect(response).toBe(assetsResponse);
    expect(assetsFetch).toHaveBeenCalledWith(request);
  });

  it("rejects a non-GET/HEAD method on an engine path with 405", async () => {
    const { env, get } = fakeEnv();
    const { ctx } = fakeCtx();
    const request = new Request(`http://localhost${ENGINE_PATH}`, {
      method: "POST",
    });

    const response = await handle(request, env, ctx, fakeCache());

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(get).not.toHaveBeenCalled();
  });

  // Standard URL parsing collapses a `..` segment — literal or
  // percent-encoded — before `handle()` ever sees it (see the `decodeKey`
  // comment in index.ts), so both requests end up with a pathname that no
  // longer starts with "/engines/xl/" and fall through to the ASSETS
  // fallback, which 404s because no such asset exists either.
  it.each([
    ["a literal .. segment", "/engines/xl/../x"],
    ["a percent-encoded .. segment", "/engines/xl/%2e%2e/x"],
  ])("resolves %s to a 404 without ever reaching R2", async (_name, path) => {
    const { env, get, assetsFetch } = fakeEnv();
    const { ctx } = fakeCtx();
    const request = new Request(`http://localhost${path}`);

    const response = await handle(request, env, ctx, fakeCache());

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
    expect(assetsFetch).toHaveBeenCalled();
  });

  it("rejects a key that doesn't match the id@version/file shape", async () => {
    const { env, get, assetsFetch } = fakeEnv();
    const { ctx } = fakeCtx();
    const request = new Request("http://localhost/engines/xl/not-a-valid-key");

    const response = await handle(request, env, ctx, fakeCache());

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("returns 404 when the object doesn't exist in R2", async () => {
    const { env, get, assetsFetch } = fakeEnv({ get: async () => null });
    const { ctx } = fakeCtx();
    const request = new Request(`http://localhost${ENGINE_PATH}`);

    const response = await handle(request, env, ctx, fakeCache());

    expect(response.status).toBe(404);
    expect(get).toHaveBeenCalledWith(ENGINE_KEY, {
      range: request.headers,
      onlyIf: request.headers,
    });
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("returns a cache hit without calling R2", async () => {
    const cache = fakeCache();
    const request = new Request(`http://localhost${ENGINE_PATH}`);
    await cache.put(request, new Response("cached body"));
    const { env, get } = fakeEnv();
    const { ctx } = fakeCtx();

    const response = await handle(request, env, ctx, cache);

    expect(await response.text()).toBe("cached body");
    expect(get).not.toHaveBeenCalled();
  });

  it("fetches from R2 on a miss, returns full headers with .wasm content-type, and caches the result", async () => {
    const object: FakeR2Object = {
      httpEtag: '"abc123"',
      size: 10,
      body: streamOf("0123456789"),
    };
    const { env, assetsFetch } = fakeEnv({ get: async () => object });
    const cache = fakeCache();
    const putSpy = vi.spyOn(cache, "put");
    const { ctx, waited } = fakeCtx();
    const request = new Request(`http://localhost${ENGINE_PATH}`);

    const response = await handle(request, env, ctx, cache);
    await Promise.all(waited);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/wasm");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("ETag")).toBe('"abc123"');
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("returns headers with no body for HEAD", async () => {
    const object: FakeR2Object = {
      httpEtag: '"abc123"',
      size: 5,
      body: streamOf("hello"),
    };
    const { env } = fakeEnv({ get: async () => object });
    const { ctx } = fakeCtx();
    const request = new Request(`http://localhost${ENGINE_PATH}`, {
      method: "HEAD",
    });

    const response = await handle(request, env, ctx, fakeCache());

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Length")).toBe("5");
  });

  it("returns 206 with Content-Range for a ranged request", async () => {
    const object: FakeR2Object = {
      httpEtag: '"abc123"',
      size: 500,
      range: { offset: 0, length: 100 },
      body: streamOf("x".repeat(100)),
    };
    const { env, get } = fakeEnv({ get: async () => object });
    const { ctx } = fakeCtx();
    const request = new Request(`http://localhost${ENGINE_PATH}`, {
      headers: { Range: "bytes=0-99" },
    });

    const response = await handle(request, env, ctx, fakeCache());

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-99/500");
    expect(response.headers.get("Content-Length")).toBe("100");
    expect(get).toHaveBeenCalledWith(ENGINE_KEY, {
      range: request.headers,
      onlyIf: request.headers,
    });
  });
});
