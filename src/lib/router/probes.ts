import type { Capabilities } from "@/lib/registry";

/**
 * `lib.dom.d.ts` does not declare these — `showSaveFilePicker` (File System
 * Access) and `navigator.deviceMemory` (Device Memory API) are both
 * non-standard/Chromium-only — so there is no typed property to read off `g`
 * directly. These narrow the shape just enough to check for them without
 * resorting to `any`.
 */
interface MaybeFileSystemAccessGlobal {
  showSaveFilePicker?: unknown;
}
interface MaybeDeviceMemoryNavigator {
  deviceMemory?: unknown;
}

/**
 * Probes what the current global scope can actually do, so the router
 * resolves a tool's pipeline against reality instead of a guess. Takes `g` —
 * defaulting to `globalThis` — so tests can inject a fake scope; every field
 * is read directly off `g` with a `typeof`/`in` check and this must never
 * throw, whether called from `window` or from inside a worker where several
 * of these globals (`showSaveFilePicker` chief among them) simply don't
 * exist.
 *
 * A WebCodecs constructor being present is not the same as a given codec
 * being supported — `VideoDecoder` can exist and still reject every codec
 * string handed to it. Whether a *specific* codec works is answered by
 * `isConfigSupported()`, which is async and per-codec, so that check belongs
 * to the engine that needs the answer, not here.
 */
export function probeCapabilities(
  g: typeof globalThis = globalThis,
): Capabilities {
  const crossOriginIsolated = g.crossOriginIsolated === true;

  const sharedArrayBuffer =
    typeof g.SharedArrayBuffer === "function" && crossOriginIsolated;

  const offscreenCanvas = typeof g.OffscreenCanvas === "function";

  const webCodecs = {
    videoDecoder: typeof g.VideoDecoder === "function",
    videoEncoder: typeof g.VideoEncoder === "function",
    audioDecoder: typeof g.AudioDecoder === "function",
    audioEncoder: typeof g.AudioEncoder === "function",
  };

  const opfs = typeof g.navigator?.storage?.getDirectory === "function";

  // Main-thread-only API: absent from every worker scope by construction, so
  // this only ever comes back true on `window`.
  const fileSystemAccess =
    "showSaveFilePicker" in g &&
    typeof (g as MaybeFileSystemAccessGlobal).showSaveFilePicker === "function";

  const hc = g.navigator?.hardwareConcurrency;
  const hardwareConcurrency =
    typeof hc === "number" && Number.isInteger(hc) && hc >= 1 ? hc : 1;

  const nav = g.navigator as MaybeDeviceMemoryNavigator | undefined;
  const deviceMemoryGb =
    typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null;

  return {
    crossOriginIsolated,
    sharedArrayBuffer,
    offscreenCanvas,
    webCodecs,
    opfs,
    fileSystemAccess,
    hardwareConcurrency,
    deviceMemoryGb,
  };
}
