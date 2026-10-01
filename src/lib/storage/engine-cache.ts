/**
 * Cache API access for the /storage page (main thread, no decoding: invariant
 * 2 only bans decode/encode/zip). Reads the service worker's engine cache.
 */
import { ENGINE_CACHE } from "./cache-names";
import type { CachedEntry } from "./engines";

/**
 * Every cached engine file with its size. Uses Content-Length when the
 * response carries one (no body read); only falls back to reading the blob
 * for a response without it.
 */
export async function listEngineEntries(): Promise<CachedEntry[]> {
  if (!("caches" in globalThis)) return [];
  const cache = await caches.open(ENGINE_CACHE);
  const requests = await cache.keys();
  return Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      const header = Number(response?.headers.get("content-length"));
      const bytes =
        Number.isFinite(header) && header > 0
          ? header
          : ((await response?.blob())?.size ?? 0);
      return { url: new URL(request.url).pathname, bytes };
    }),
  );
}

/** Deletes the given cache entries (pathnames from `listEngineEntries`). */
export async function deleteEngineEntries(
  pathnames: readonly string[],
): Promise<void> {
  const cache = await caches.open(ENGINE_CACHE);
  await Promise.all(pathnames.map((p) => cache.delete(p)));
}

/** Drops the whole engine cache. */
export async function deleteEngineCache(): Promise<void> {
  await caches.delete(ENGINE_CACHE);
}
