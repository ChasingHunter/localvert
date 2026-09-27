/**
 * Environment-neutral (no DOM — see ADR-0005): `engine-host.ts` runs this
 * inside the worker to keep a stalled engine load/run from hanging a job
 * forever. `setTimeout`/`clearTimeout` are available in both DOM and
 * WebWorker globals, so this file needs nothing beyond that.
 */

export interface IdleTimeoutOptions {
  /** How long `run` may go without calling `poke()` before this rejects. */
  ms: number;
  /** Builds the error to reject with, called only if the timer actually
   * fires — never eagerly, so it can inspect state (e.g. "are we offline
   * *now*") at the moment of the real timeout rather than at call time. */
  onTimeout: () => Error;
}

/**
 * Races `run(poke)` against an idle timer that resets every time `run` calls
 * `poke()` — not a flat deadline on the whole call. A step that keeps
 * reporting real progress (a long but healthy video transcode, say) can run
 * past `ms` indefinitely; a step that goes completely silent for `ms` (a
 * stalled fetch that neither resolves nor rejects — the shape of the
 * offline/never-cached-engine hang this exists to catch) times out.
 *
 * `run`'s own settlement always wins a genuine race (its result/rejection is
 * used, and the idle timer is cleared) — the timeout only fires when `run`
 * has gone silent for the full `ms`, at which point `run`'s eventual
 * settlement (if it ever comes) is simply ignored.
 */
export function withIdleTimeout<T>(
  run: (poke: () => void) => Promise<T>,
  { ms, onTimeout }: IdleTimeoutOptions,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: ((e: Error) => void) | undefined;

  function poke(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      rejectTimeout?.(onTimeout());
    }, ms);
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  // Nothing awaits this until raced below — swallow so a timeout firing
  // after `run` already won the race doesn't surface as an unhandled
  // rejection.
  timeoutPromise.catch(() => {});

  poke();

  return Promise.race([run(poke), timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    // Nothing can reject `timeoutPromise` after this point usefully — drop
    // the reference so a late, already-irrelevant firing (impossible once
    // cleared, but the field stays honest either way) can't call it.
    rejectTimeout = undefined;
  });
}
