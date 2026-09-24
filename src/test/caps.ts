import type { Capabilities } from "@/lib/registry";

const DEFAULT_CAPS: Capabilities = {
  crossOriginIsolated: true,
  sharedArrayBuffer: true,
  offscreenCanvas: true,
  webCodecs: {
    videoDecoder: true,
    videoEncoder: true,
    audioDecoder: true,
    audioEncoder: true,
  },
  opfs: true,
  fileSystemAccess: true,
  hardwareConcurrency: 8,
  deviceMemoryGb: 8,
};

type CapsOverrides = Partial<Omit<Capabilities, "webCodecs">> & {
  webCodecs?: Partial<Capabilities["webCodecs"]>;
};

/**
 * `Capabilities` for a "modern, cross-origin-isolated desktop Chrome" —
 * every probe true, 8 cores, 8 GB of memory. Pass `overrides` for the one or
 * two fields a test actually cares about; `webCodecs` merges shallowly, so
 * `{ webCodecs: { videoDecoder: false } }` doesn't also unset the sibling
 * codec flags.
 */
export function makeCaps(overrides?: CapsOverrides): Capabilities {
  return {
    ...DEFAULT_CAPS,
    ...overrides,
    webCodecs: { ...DEFAULT_CAPS.webCodecs, ...overrides?.webCodecs },
  };
}
