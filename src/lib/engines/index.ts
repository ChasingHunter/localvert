// NOTE: this barrel must never import an adapter. Adapters are imported only
// by dynamic `import()` inside a worker (see docs/ARCHITECTURE.md, Engines).
// This file stays importable from the main thread.
export { defineEngine } from "./define-engine";
export type { EngineErrorCode } from "./errors";
export {
  EngineError,
  isEngineError,
  toEngineError,
} from "./errors";
export type { EngineManifestEntry, EngineMeta } from "./meta";
export { engineBaseUrl } from "./meta";
export type {
  EngineAdapter,
  EngineAsset,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineLocation,
  EngineMarker,
  EngineResult,
  EngineTask,
  RasterImage,
} from "./types";
