import type { EngineAsset, EngineLocation } from "./types";

/**
 * Static metadata for one engine, as declared in its `engine.json` — the
 * source of truth `pnpm gen` reads to build `ids.ts` and `manifest.ts` (see
 * the `add-engine` skill and docs/ARCHITECTURE.md, "Engines"). `assets` is
 * filled in by the future `sync-engines` script (Phase 0.7); empty for a
 * "native" engine, which ships no assets of its own.
 */
export interface EngineMeta {
  id: string;
  version: string;
  license: string;
  location: EngineLocation;
  needsIsolation: boolean;
  heavy: boolean;
  assets: readonly EngineAsset[];
}

/**
 * `EngineMeta` plus what `pnpm gen` derives for main-thread consumption:
 * where the engine's assets are actually served from, and their combined
 * size. This is the shape of each value in the generated `ENGINE_MANIFEST`
 * (`src/lib/engines/manifest.ts`).
 */
export interface EngineManifestEntry extends EngineMeta {
  baseUrl: string;
  totalBytes: number;
}

/**
 * Pure. Where an engine's assets are served from, by `location`:
 *  - "native": ships no assets of its own — empty string, unused.
 *  - "static": this origin's `public/engines/<id>@<version>/`, immutable
 *    per version.
 *  - "r2": the same origin's R2-backed `/engines/xl/<id>@<version>/`
 *    prefix, for engines too large to ship as a static asset — see
 *    docs/adr/0003-workers-static-assets-over-pages.md.
 */
export function engineBaseUrl(
  meta: Pick<EngineMeta, "id" | "version" | "location">,
): string {
  switch (meta.location) {
    case "native":
      return "";
    case "static":
      return `/engines/${meta.id}@${meta.version}/`;
    case "r2":
      return `/engines/xl/${meta.id}@${meta.version}/`;
  }
}
