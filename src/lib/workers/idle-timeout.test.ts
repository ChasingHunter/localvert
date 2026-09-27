import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withIdleTimeout } from "./idle-timeout";

describe("withIdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with run's own result when it settles before the idle window elapses", async () => {
    const promise = withIdleTimeout(
      async (poke) => {
        poke();
        return "done";
      },
      { ms: 1000, onTimeout: () => new Error("timed out") },
    );
    await expect(promise).resolves.toBe("done");
  });

  it("rejects with run's own rejection when it rejects before the idle window elapses", async () => {
    const promise = withIdleTimeout(
      async () => {
        throw new Error("real failure");
      },
      { ms: 1000, onTimeout: () => new Error("timed out") },
    );
    await expect(promise).rejects.toThrow("real failure");
  });

  it("rejects with the timeout error when run never settles and never pokes", async () => {
    const promise = withIdleTimeout<never>(() => new Promise<never>(() => {}), {
      ms: 1000,
      onTimeout: () => new Error("stalled"),
    });
    const assertion = expect(promise).rejects.toThrow("stalled");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("does not time out a long-running call that keeps poking within the window", async () => {
    let resolveRun: ((v: string) => void) | undefined;
    const run = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });

    const promise = withIdleTimeout(
      async (poke) => {
        // Poke every 400ms, well inside the 1000ms idle window, for longer
        // than the window itself (2200ms total) — never fully silent.
        for (let i = 0; i < 5; i++) {
          await vi.advanceTimersByTimeAsync(400);
          poke();
        }
        return run;
      },
      { ms: 1000, onTimeout: () => new Error("should never fire") },
    );

    resolveRun?.("finished late");
    await expect(promise).resolves.toBe("finished late");
  });

  it("times out a call that pokes for a while and then goes silent", async () => {
    const promise = withIdleTimeout<never>(
      (poke) =>
        new Promise<never>(() => {
          poke();
          setTimeout(poke, 500); // one poke at 500ms, then silence
        }),
      { ms: 1000, onTimeout: () => new Error("went silent") },
    );
    const assertion = expect(promise).rejects.toThrow("went silent");
    // 500ms (poke) + 1000ms idle window after that poke = 1500ms total.
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
  });
});
