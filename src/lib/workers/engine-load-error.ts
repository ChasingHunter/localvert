import { EngineError } from "@/lib/engines";
import type { EngineId } from "@/lib/registry";

/**
 * Turns "an engine failed to load or run" into a message that tells the user
 * something they can actually act on, instead of a generic "load-failed" —
 * see the "offline + never-cached engine" bug this exists to fix
 * (docs the mechanism: `engine-host.ts`'s `run()` wraps both `loadEngine` and
 * `instance.run` in `withIdleTimeout`; whatever causes the stall (or a plain
 * rejection) lands here for classification before it crosses back to the
 * job store).
 */

export const OFFLINE_MESSAGE =
  "This converter needs a one-time download and you're offline. Connect once and it will work offline afterwards.";

export interface ClassifyLoadFailureOptions {
  engine: EngineId;
  /** The underlying cause — a rejection from the loader/adapter/fetch, or
   * `undefined` when this is a timeout with nothing more specific to blame. */
  cause?: unknown;
  /** `navigator.onLine === false` at the moment of failure — see `isOffline`
   * below. Takes priority over `timedOut`: offline *is* almost always why a
   * never-cached engine's load stalled out. */
  offline: boolean;
  /** True when `withIdleTimeout` fired rather than the load/run itself
   * rejecting. */
  timedOut: boolean;
}

export function classifyLoadFailure(
  opts: ClassifyLoadFailureOptions,
): EngineError {
  const { engine, cause, offline, timedOut } = opts;

  if (offline) {
    return new EngineError("offline", OFFLINE_MESSAGE, { engine, cause });
  }

  if (timedOut) {
    return new EngineError(
      "load-timeout",
      `engine "${engine}" took too long to load or respond — check your connection and try again`,
      { engine, cause },
    );
  }

  return new EngineError("load-failed", `engine "${engine}" failed to load`, {
    engine,
    cause,
  });
}

/**
 * `navigator.onLine === false` is a real (if imperfect — see MDN) signal:
 * the platform itself knows it has no connection. It is `true` whenever the
 * platform merely *thinks* it might be online, so a merely-broken origin
 * still reports `true` here — that case falls through to the generic
 * load-failed/timeout messages above instead of the offline one, which is
 * the intended split (this repo has no way to distinguish "DNS is down" from
 * "this one asset 404s" from inside a worker, and shouldn't guess).
 *
 * `navigator` exists on the WebWorker global too (`WorkerNavigator` carries
 * the same `NavigatorOnLine` mixin as `Window` — see ADR-0005 for why this
 * file, like `engine-host.ts` that calls it, must stay DOM-free otherwise).
 */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * True for the browser's own "the network request itself never got a
 * response" errors — as opposed to a request that reached the server and
 * got back a real HTTP error, or an unrelated bug in this app's own code.
 * Some engines (e.g. jsquash) fetch their wasm lazily inside `run()` rather
 * than `load()`, so a never-cached engine going offline mid-run surfaces
 * here as a plain rejection with no `offline`/`timedOut` flag attached —
 * this is what lets `engine-host.ts`'s run-step catch recognize that case
 * and map it to the same friendly offline message as a load failure,
 * instead of a raw "Failed to fetch" reaching the job store.
 *
 * Chromium/V8 rejects with `TypeError: Failed to fetch`; Firefox with
 * `TypeError: NetworkError when attempting to fetch resource`; Safari with
 * `TypeError: Load failed`. All three are plain `TypeError`s with no more
 * specific `DOMException` name to switch on, so this matches on message text.
 */
export function isNetworkFailure(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false;
  return /failed to fetch|networkerror|load failed/i.test(e.message);
}
