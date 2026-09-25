/**
 * The service worker. Bundled and precache-injected by `scripts/build-sw.ts`
 * as the last step of `pnpm build` — see that script's header comment for
 * why the manifest is computed post-build against the final `out/` bytes
 * instead of via `@serwist/turbopack`'s usual Next.js Route Handler.
 *
 * Caching (docs/ARCHITECTURE.md, "Delivery"):
 *   - The app shell (every page, `_next/static` JS/CSS) is precached on
 *     install via `self.__SW_MANIFEST`, injected at build time.
 *   - `/engines/*` (including `/engines/xl/*`, proxied through the R2
 *     Worker — see infra/worker/index.ts) is `CacheFirst` in a dedicated,
 *     unbounded cache: those URLs are versioned (`<id>@<version>/...`), so a
 *     cached response is never stale, and content never needs evicting.
 *   - A navigation that isn't in the precache list (i.e. not a real route)
 *     tries the network, same as with no service worker at all — so an
 *     online visitor still gets a real 404. Only when that fetch itself
 *     fails (offline) does `fallbacks` step in with the precached
 *     `/offline` page.
 */

import type { PrecacheEntry, SerwistPlugin } from "serwist";
import {
  CacheableResponsePlugin,
  CacheFirst,
  NetworkOnly,
  Serwist,
} from "serwist";
import { rewrapCachedResponse } from "./sw-helpers";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[];
};

/**
 * Precache plugin fixing the Turbopack-worker-bootstrap bug (see
 * sw-helpers.ts's doc comment for the full mechanism). Precached requests go
 * through Serwist's own `cacheKeyWillBeUsed` first, which replaces the
 * `Request` object with a fresh one built from the plain cache-key URL — so
 * by the time `cachedResponseWillBeUsed` runs, `request.destination` is
 * already lost. `event.request` is the original, browser-supplied request
 * (the one actually fetching the worker script) and still has it.
 */
const precacheWorkerScriptFix: SerwistPlugin = {
  cachedResponseWillBeUsed({ event, cachedResponse }) {
    if (!cachedResponse) return cachedResponse;
    // `event` is an `InstallEvent` (no `.request`) during precache install,
    // and only a `FetchEvent` (has `.request`) when actually serving a
    // `fetch` — hence the optional chain rather than a plain property read.
    const destination = (event as FetchEvent).request?.destination;
    if (destination === "worker" || destination === "sharedworker") {
      return rewrapCachedResponse(cachedResponse);
    }
    return cachedResponse;
  },
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    plugins: [precacheWorkerScriptFix],
  },
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    {
      matcher: ({ url }) => url.pathname.startsWith("/engines/"),
      handler: new CacheFirst({
        cacheName: "localvert-engines-v1",
        // Belt and suspenders: Serwist already refuses to cache anything
        // but a plain 200 when no plugin says otherwise (opaque responses
        // have status 0), but an engine asset is exactly the kind of thing
        // that must never silently cache a CORS-opaque or error response,
        // so it's spelled out explicitly here.
        plugins: [new CacheableResponsePlugin({ statuses: [200] })],
      }),
    },
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
});

serwist.addEventListeners();
