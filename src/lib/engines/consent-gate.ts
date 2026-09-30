/**
 * The consent gate's manifest-aware half. `tool-runner.tsx` imports this
 * lazily (only once a file is actually being submitted) so the generated
 * `ENGINE_MANIFEST` (every engine's asset list) is not part of every tool
 * page's first-load JS. The pure logic lives in `consent.ts`.
 */

import type { ConsentStorage } from "@/lib/engines/consent";
import {
  downloadBytes,
  enginesNeedingConsent,
  grantConsent,
  hasConsent,
} from "@/lib/engines/consent";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { EngineId, ToolDefinition } from "@/lib/registry/types";

/**
 * Upstream source repository per consent-gated engine, for the GPL
 * source-offer link in `EngineConsentDialog` (ADR-0002 rule 5) — a UI-only
 * concern, so it lives here rather than in the generated manifest.
 */
const ENGINE_SOURCE_URLS: Partial<Record<EngineId, string>> = {
  ffmpeg: "https://github.com/ffmpegwasm/ffmpeg.wasm",
  // The npm package's own page — it has no repository field or README (see
  // docs/adr/0012-libreoffice-office-to-pdf.md's provenance note). The
  // corresponding LibreOffice *core* source (MPL-2.0's actual obligation,
  // since this package is a wasm build of it, not a fork) is linked from
  // that ADR instead of here — the dialog only ever shows one link.
  libreoffice: "https://www.npmjs.com/package/@bentopdf/libreoffice-wasm",
};

/** What the consent dialog needs to render one engine's prompt. */
export interface ConsentPrompt {
  engineId: EngineId;
  license: string;
  bytes: number;
  sourceUrl: string;
}

/**
 * The first consent-gated engine `tool` might reach that the user has not
 * yet agreed to, or `null` if every one is granted (or none needs consent).
 */
export function pendingConsentPrompt(
  tool: Pick<ToolDefinition, "pipeline">,
  storage: ConsentStorage,
): ConsentPrompt | null {
  const id = enginesNeedingConsent(tool, ENGINE_MANIFEST).find(
    (engineId) =>
      !hasConsent(storage, engineId, ENGINE_MANIFEST[engineId].version),
  );
  if (!id) return null;
  const entry = ENGINE_MANIFEST[id];
  return {
    engineId: id,
    license: entry.license,
    bytes: downloadBytes(entry),
    sourceUrl: ENGINE_SOURCE_URLS[id] ?? "#",
  };
}

/** Records consent for the current manifest version of `id`. */
export function grantEngineConsent(
  storage: ConsentStorage,
  id: EngineId,
): void {
  grantConsent(storage, id, ENGINE_MANIFEST[id].version);
}
