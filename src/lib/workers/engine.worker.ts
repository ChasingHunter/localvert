import * as Comlink from "comlink";
import { ENGINE_LOADERS } from "@/lib/engines/loaders";
import { probeCapabilities } from "@/lib/router/probes";
import { createEngineHost, transferablesOf } from "./engine-host";
import type { EngineHostApi, RunOutcome, RunRequest } from "./protocol";

/**
 * The real engine worker entry point — the "Phase 0.5" factory `pool.ts` and
 * `workers/index.ts` point to. Spawned by `spawn.ts` on the main thread via
 * `new Worker(new URL("./engine.worker.ts", import.meta.url))`; everything
 * below runs inside that worker, never on the main thread.
 *
 * Typechecked by `tsconfig.worker.json` (WebWorker lib, no DOM) — see
 * ADR-0005.
 */

const host = createEngineHost(ENGINE_LOADERS, () => probeCapabilities(self));

const api: EngineHostApi = {
  probe: host.probe,
  cancel: host.cancel,
  dispose: host.dispose,
  async run(
    req: RunRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<RunOutcome> {
    // `onProgress` arrives as a Comlink proxy when the caller supplied one —
    // `host.run` already calls it (never awaits it) at most 10x/sec, so no
    // extra handling is needed here beyond passing it through.
    const outcome = await host.run(req, onProgress);
    // Moves the result's bytes/stream to the caller instead of structured-
    // cloning a copy of them.
    return Comlink.transfer(outcome, transferablesOf(outcome));
  },
};

Comlink.expose(api);
