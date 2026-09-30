/**
 * Serves oversized ("xl") engines from R2 under `/engines/xl/*`.
 *
 * `wrangler.jsonc`'s `run_worker_first: ["/engines/xl/*"]` means this is the
 * *only* traffic this Worker ever sees in production — everything else
 * (the static export, and every engine ≤20 MiB) is served directly by the
 * Asset Worker, for free, without running any of this code (ADR-0003). The
 * `env.ASSETS.fetch(request)` fallback below exists for local dev and as a
 * defensive backstop, not because production traffic is expected to reach
 * it.
 *
 * `handle` is exported separately from the default export so it can be unit
 * tested with plain fakes for `env`, `ctx` and `cache` — no `wrangler dev` /
 * Miniflare instance required. See `index.test.ts`.
 */

import { COEP, CSP } from "./security-headers";

/** "/engines/xl/<id>--<version>/<file...>" once the leading "/engines/" is
 * stripped. `--` (not `@`) separates id from version — see
 * `src/lib/engines/meta.ts`'s `engineBaseUrl` doc comment for why. */
const KEY_PATTERN =
  /^xl\/[a-z0-9-]+--[0-9A-Za-z.+-]+\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  // Required for WebAssembly.instantiateStreaming to accept the response.
  wasm: "application/wasm",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  data: "application/octet-stream",
  bin: "application/octet-stream",
  traineddata: "application/octet-stream",
};

/**
 * Turns a request pathname into the R2 object key, or `null` if it isn't a
 * well-formed engine asset path.
 *
 * Percent-encoding is decoded first so validation runs against the real
 * path rather than an encoded disguise of one; a failed decode is rejected
 * outright. `KEY_PATTERN`'s per-segment character class allows `.`, so a
 * literal `..` segment would otherwise satisfy it — checked separately.
 * (In practice, standard URL parsing already collapses `../` and its
 * percent-encoded forms before this function ever sees them — see
 * `index.test.ts`'s traversal cases — but the request path is untrusted
 * input and this function should not depend on that upstream behaviour to
 * stay safe.)
 */
function decodeKey(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const key = decoded.slice("/engines/".length);
  if (!KEY_PATTERN.test(key)) return null;
  if (key.split("/").includes("..")) return null;
  return key;
}

function contentTypeFor(object: R2Object, key: string): string {
  if (object.httpMetadata?.contentType) return object.httpMetadata.contentType;
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Common headers for every response that actually reached R2. */
function objectHeaders(object: R2Object, key: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentTypeFor(object, key));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.httpEtag);
  // The page is cross-origin isolated (COEP: require-corp), so every
  // sub-resource must opt in with CORP or the browser drops it — but
  // `public/_headers` is only applied to responses the Asset Worker serves.
  // This Worker's responses bypass that layer entirely, so the header has
  // to be set here explicitly or every xl-engine fetch would fail to load.
  // (COEP and CSP get the same treatment just below, for the same reason.)
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  // A worker's own COEP/CSP come from its SCRIPT'S OWN response, not the
  // page that spawned it — required for the libreoffice adapter's nested
  // `new Worker()` load (ADR-0012) to start at all under this app's
  // cross-origin-isolated page. See `security-headers.ts`'s doc comment.
  headers.set("Cross-Origin-Embedder-Policy", COEP);
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Accept-Ranges", "bytes");
  return headers;
}

/** Inclusive start/end byte offsets an R2 range response actually covers. */
function byteRange(
  range: R2Range,
  size: number,
): { start: number; end: number } {
  if ("suffix" in range) {
    return { start: Math.max(size - range.suffix, 0), end: size - 1 };
  }
  const start = range.offset ?? 0;
  const end = range.length !== undefined ? start + range.length - 1 : size - 1;
  return { start, end };
}

export async function handle(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cache: Cache,
): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/engines/xl/")) {
    return env.ASSETS.fetch(request);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const key = decodeKey(url.pathname);
  if (key === null) {
    return new Response("Not Found", { status: 404 });
  }

  // Cache only plain GETs. A Range request must always reach R2 so the
  // requested slice can be honored, and the full-body cache entry (see the
  // 200 branch below) is keyed on a Range-less request in the first place.
  if (request.method === "GET" && !request.headers.has("Range")) {
    const cached = await cache.match(request);
    if (cached) return cached;
  }

  // `range` is only ever passed when the client actually sent a `Range`
  // header. Passing `request.headers` through unconditionally used to work
  // against real R2 (which itself only honors an actual `Range` header) but
  // broke against `wrangler dev --local`'s Miniflare R2 simulator, which
  // synthesizes a bogus range (`Content-Range: bytes NaN-<size-1>/<size>`)
  // for a plain GET with no `Range` header at all — found via the
  // libreoffice engine's nested `new Worker(...)` load (ADR-0012), the first
  // consumer of an r2-hosted classic worker script: Chrome's worker-script
  // fetch algorithm rejects that malformed partial response outright
  // (`net::ERR_BLOCKED_BY_RESPONSE`), where a plain `fetch()`/`import()`
  // consumer (every other r2 engine so far) tolerated it silently.
  const hasRangeHeader = request.headers.has("Range");
  const object = await env.ENGINES.get(key, {
    range: hasRangeHeader ? request.headers : undefined,
    onlyIf: request.headers,
  });

  if (object === null) {
    return new Response("Not Found", { status: 404 });
  }

  const headers = objectHeaders(object, key);

  // A conditional request (If-None-Match / If-Match / If-Modified-Since /
  // If-Unmodified-Since via `onlyIf`) that didn't pass comes back as an
  // `R2Object` with no `body`. The case this Worker actually exercises is
  // revalidation with If-None-Match, which means the client's cached copy
  // is still current.
  if (!("body" in object)) {
    return new Response(null, { status: 304, headers });
  }

  const isHead = request.method === "HEAD";

  if (object.range) {
    const { start, end } = byteRange(object.range, object.size);
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(isHead ? null : object.body, {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(object.size));
  const response = new Response(isHead ? null : object.body, {
    status: 200,
    headers,
  });
  if (!isHead) {
    ctx.waitUntil(cache.put(request, response.clone()));
  }
  return response;
}

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx, caches.default),
} satisfies ExportedHandler<Env>;
