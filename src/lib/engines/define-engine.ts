import type { EngineAdapter } from "./types";

const VERSION_RE = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/**
 * Validates an engine adapter at definition time — as soon as the adapter's
 * module runs — so a malformed adapter fails loudly before it can be routed
 * to. Returns `a` unchanged; this is a check, not a transform.
 */
export function defineEngine(a: EngineAdapter): EngineAdapter {
  const fail = (message: string): never => {
    throw new Error(`[engine ${a.id}] ${message}`);
  };

  if (a.marker !== `localvert-engine:${a.id}`) {
    fail(`marker "${a.marker}" must be exactly "localvert-engine:${a.id}"`);
  }
  if (!VERSION_RE.test(a.version)) {
    fail(`version "${a.version}" must be semver, e.g. "1.0.0"`);
  }
  if (a.license.trim() === "") {
    fail("license must not be empty");
  }

  // location "native" with needsIsolation true is a valid combination — no
  // check needed there.

  return a;
}
