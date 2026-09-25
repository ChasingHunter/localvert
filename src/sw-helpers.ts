/**
 * Pure helpers for `src/sw.ts`, split out so they can be unit-tested without
 * a service worker (or even a DOM) — see vitest.config.ts's node
 * environment. No import of `serwist` or any global `self` here.
 */

/**
 * Re-wraps a `Response` read from the Cache API so it carries no URL of its
 * own.
 *
 * Why this matters: Turbopack spawns every Web Worker through a bootstrap
 * script whose configuration travels in the URL *fragment* —
 * `/_next/static/chunks/turbopack-worker-<hash>.js#params=[...]`. Fragments
 * are never sent over the wire, so they're not part of a `Response`'s own
 * URL. A `Response` handed back from `caches.match()` carries the precached
 * request's (fragment-less) URL in its internal URL list, and the browser
 * uses *that* as `self.location` inside a worker constructed from it —
 * Turbopack's bootstrap then throws "Missing worker bootstrap config"
 * because the params it expected in the fragment are gone.
 *
 * `new Response(...)` has no way to set a URL, so the Response it produces
 * has an *empty* URL list. With an empty list, the browser falls back to
 * the original *request* URL — fragment intact — as the worker's location.
 * Used by `src/sw.ts`'s precache plugin, only for requests whose
 * `destination` is `"worker"` or `"sharedworker"`; every other precached
 * response is returned exactly as read from the cache, unwrapped.
 */
export function rewrapCachedResponse(cached: Response): Response {
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}
