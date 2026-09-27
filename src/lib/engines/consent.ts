/**
 * ADR-0002 rule 4: an engine with `consent: true` in the generated
 * `ENGINE_MANIFEST` (e.g. `ffmpeg` — GPL-2.0-or-later, ~31 MB) must not
 * download until the user has explicitly agreed to it. This module is the
 * pure logic behind that gate: which engines a tool needs consent for, how
 * big the download is, and whether consent was already granted and
 * remembered. `src/components/engine-consent-dialog.tsx` is the prompt UI;
 * `src/components/tool-runner.tsx` wires the two together in front of every
 * job-submission path.
 *
 * No DOM imports beyond the `storage` parameter callers pass in (typically
 * `window.localStorage`) — kept swappable and testable without jsdom.
 */
import type { EngineManifestEntry } from "@/lib/engines/meta";
import type { EngineId, ToolDefinition } from "@/lib/registry/types";

/** Anything that behaves like `Storage` (`getItem`/`setItem`) — narrowed so
 * tests can pass an in-memory fake instead of a real `localStorage`. */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Every distinct engine id `tool`'s pipeline might dispatch to that needs a
 * consent gate, per `manifest` — a step can have several candidates (router
 * fallback order), so this checks all of them, not just the first. Order
 * follows the pipeline/candidate order, de-duplicated by id.
 */
export function enginesNeedingConsent(
  tool: Pick<ToolDefinition, "pipeline">,
  manifest: Readonly<Record<string, EngineManifestEntry>>,
): EngineId[] {
  const seen = new Set<EngineId>();
  const result: EngineId[] = [];
  for (const step of tool.pipeline) {
    for (const candidate of step.candidates) {
      const id = candidate.engine;
      if (seen.has(id)) continue;
      seen.add(id);
      if (manifest[id]?.consent) result.push(id);
    }
  }
  return result;
}

/** Total download size of one engine's assets, in bytes — what the consent
 * prompt shows the user before it fetches anything. */
export function downloadBytes(
  entry: Pick<EngineManifestEntry, "assets">,
): number {
  return entry.assets.reduce((sum, a) => sum + a.bytes, 0);
}

/** Storage key for one engine version's consent — versioned so a later
 * engine upgrade (different license terms, different size) asks again. */
function consentKey(id: string, version: string): string {
  return `localvert:engine-consent:${id}@${version}`;
}

/**
 * Whether the user already agreed to download this exact engine version.
 * Every storage access is wrapped in try/catch: private/incognito mode can
 * make `localStorage` throw synchronously, and the safe degrade is "treat
 * as not yet consented" — the dialog just asks again, it never breaks the
 * conversion.
 */
export function hasConsent(
  storage: ConsentStorage,
  id: string,
  version: string,
): boolean {
  try {
    return storage.getItem(consentKey(id, version)) === "granted";
  } catch {
    return false;
  }
}

/**
 * Records that the user agreed to download this engine version. A throwing
 * `storage` (private-mode quota, etc.) means the choice won't be
 * remembered next time — but it must not stop the current, already-granted
 * run from proceeding, so this only swallows the write failure and never
 * rethrows.
 */
export function grantConsent(
  storage: ConsentStorage,
  id: string,
  version: string,
): void {
  try {
    storage.setItem(consentKey(id, version), "granted");
  } catch {
    // Not remembered — the next drop will just ask again. See doc comment.
  }
}
