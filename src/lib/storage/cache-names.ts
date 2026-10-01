/**
 * Name of the runtime cache the service worker keeps engine files in. Must
 * match `cacheName` in `src/sw.ts` (the worker can't import app modules);
 * `cache-names.test.ts` fails if the two drift apart.
 */
export const ENGINE_CACHE = "localvert-engines-v1";
