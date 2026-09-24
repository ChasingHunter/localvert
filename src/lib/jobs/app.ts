import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { defaultPoolSize, probeCapabilities } from "@/lib/router";
import { createWorkerPool, spawnEngineWorker } from "@/lib/workers";
import type { JobEngine } from "./job-engine";
import { createJobEngine } from "./job-engine";
import { jobStore } from "./store";

/**
 * MAIN THREAD. The job engine the app actually uses, over a real worker pool
 * and the real engine worker. Lazily created on first call — importing this
 * module has no side effect, so it's safe to import from a page that never
 * ends up running a conversion (spinning up a worker pool eagerly would be
 * wasted work, and wrong during the static export build itself).
 */
let instance: JobEngine | null = null;

export function getAppJobEngine(): JobEngine {
  if (!instance) {
    const capabilities = probeCapabilities();
    const pool = createWorkerPool({
      size: defaultPoolSize(capabilities),
      spawn: spawnEngineWorker,
      isHeavy: (engine) => ENGINE_MANIFEST[engine].heavy,
    });
    instance = createJobEngine({ pool, capabilities, store: jobStore });
  }
  return instance;
}
