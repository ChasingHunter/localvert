import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { FormatId } from "./formats";
import type { EngineCandidate, EngineId, PipelineStep } from "./types";

/**
 * ADR-0007: an image tool's pipeline is decode -> transform* -> encode, with
 * a raster intermediate (`RasterImage`, `src/lib/engines/types.ts`) passed
 * between steps inside one worker. `imagePipeline` builds those steps from
 * these codec preference tables instead of every tool file repeating the
 * candidate lists by hand.
 *
 * Every list here is in preference order (dedicated codec first, `canvas` —
 * or another browser-native fallback — last) and every candidate is
 * unconditional (no `when`): a step's eligibility narrows only by which
 * engines are actually built yet (`ENGINE_MANIFEST`), never by runtime
 * capability. Naming an engine id ahead of its own adapter landing is fine —
 * `imagePipeline` filters against `ENGINE_MANIFEST` at call time (below) and
 * simply won't offer it as a candidate until then.
 */
const DECODE_PREFERENCE: Partial<Record<FormatId, readonly string[]>> = {
  jpg: ["jsquash-jpeg", "canvas"],
  png: ["jsquash-png", "canvas"],
  webp: ["jsquash-webp", "canvas"],
  avif: ["jsquash-avif"],
  jxl: ["jsquash-jxl"],
  bmp: ["canvas"],
  gif: ["canvas"],
  heic: ["heic"],
  svg: ["resvg"],
  tiff: ["utif"],
  psd: ["psd"],
  raw: ["libraw"],
};

const ENCODE_PREFERENCE: Partial<Record<FormatId, readonly string[]>> = {
  jpg: ["jsquash-jpeg", "canvas"],
  png: ["jsquash-png", "canvas"],
  webp: ["jsquash-webp", "canvas"],
  avif: ["jsquash-avif"],
  jxl: ["jsquash-jxl"],
  // Tracing (outlines, not pixels) is the only encoder to svg — see
  // `../engines/tracer/adapter.ts`.
  svg: ["tracer"],
};

export type ImageTransform = "resize" | "rotate" | "crop";

const TRANSFORM_PREFERENCE: Record<ImageTransform, readonly string[]> = {
  resize: ["jsquash-resize", "canvas"],
  rotate: ["canvas"],
  crop: ["canvas"],
};

/**
 * Filters `ids` down to the ones `ENGINE_MANIFEST` actually has an entry
 * for, casting the survivors to `EngineId` — safe because that's exactly
 * what the `in` check just proved. Throws at `imagePipeline`'s call time
 * (not at this module's load time) if nothing survives, so a tool file
 * fails loudly the moment it asks for a format/transform no built engine can
 * handle yet, rather than silently shipping a step with zero candidates.
 */
function candidatesFor(
  ids: readonly string[] | undefined,
  what: string,
): EngineCandidate[] {
  const known = (ids ?? []).filter(
    (id): id is EngineId => id in ENGINE_MANIFEST,
  );
  if (known.length === 0) {
    throw new Error(`[imagePipeline] no engine can ${what}`);
  }
  return known.map((engine) => ({ engine }));
}

/**
 * Builds the decode -> transform* -> encode pipeline for an image tool
 * converting `from` to `to`, per ADR-0007. `transforms` are applied in the
 * order given, each its own raster -> raster step.
 */
export function imagePipeline(
  from: FormatId,
  to: FormatId,
  transforms: readonly ImageTransform[] = [],
): PipelineStep[] {
  return [
    {
      op: "decode",
      from,
      to: "raster",
      candidates: candidatesFor(DECODE_PREFERENCE[from], `decode ${from}`),
    },
    ...transforms.map(
      (op): PipelineStep => ({
        op,
        from: "raster",
        to: "raster",
        candidates: candidatesFor(TRANSFORM_PREFERENCE[op], `${op} an image`),
      }),
    ),
    {
      op: "encode",
      from: "raster",
      to,
      candidates: candidatesFor(ENCODE_PREFERENCE[to], `encode ${to}`),
    },
  ];
}
