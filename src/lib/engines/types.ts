import type {
  Capabilities,
  EngineId,
  FormatId,
  Operation,
} from "@/lib/registry";

/**
 * `scripts/check-sizes.ts` (Phase 0.7) scans first-load JS chunks for the
 * substring "localvert-engine:" and fails the build if it finds one — that is
 * how invariant 3 (no engine in the core bundle) is enforced mechanically. For
 * that scan to mean anything, `marker` MUST be written as a string literal in
 * the adapter source (e.g. `marker: "localvert-engine:canvas"`), never a
 * template literal computed at runtime — minifiers preserve string literals,
 * but a runtime-computed value would defeat the scan by never appearing as
 * that substring in the built output.
 */
export type EngineMarker = `localvert-engine:${EngineId}`;

/** One engine-owned file, relative to the engine's base URL. */
export interface EngineAsset {
  path: string;
  bytes: number;
}

/**
 * One file `scripts/sync-engines.ts` copies from the source npm package into
 * this engine's asset directory. `from` is relative to the package's own
 * directory; `to` is the filename it lands as under `public/engines/<id>@<
 * version>/` (static) or `.engines-r2/xl/<id>@<version>/` (r2).
 */
export interface EngineSourceFile {
  from: string;
  to: string;
}

/**
 * Where an engine's assets live. "native" means the engine wraps a browser
 * API and ships no assets of its own — see `EngineLoadContext.baseUrl`.
 */
export type EngineLocation = "native" | "static" | "r2";

/**
 * Passed to `EngineAdapter.load`. `baseUrl` is the engine's own asset root,
 * e.g. "/engines/canvas@1.0.0/" — meaningless for a "native" engine, which
 * ignores it.
 */
export interface EngineLoadContext {
  baseUrl: string;
  capabilities: Capabilities;
}

export type EngineInput =
  | { kind: "blob"; blob: Blob }
  | { kind: "bytes"; bytes: ArrayBuffer }
  | { kind: "opfs"; path: string };

export interface EngineTask {
  op: Operation;
  input: EngineInput;
  inputFormat: FormatId;
  outputFormat: FormatId;
  options: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
  /** 0..1. The caller throttles; an adapter may call this as often as it likes. */
  onProgress?: (fraction: number) => void;
}

export type EngineResult =
  | { kind: "bytes"; bytes: ArrayBuffer; mime: string }
  | { kind: "stream"; stream: ReadableStream<Uint8Array>; mime: string }
  | { kind: "opfs"; path: string; mime: string; size: number };

export interface EngineInstance {
  run(task: EngineTask): Promise<EngineResult>;
  dispose(): void;
}

export interface EngineAdapter {
  id: EngineId;
  /** Must match the asset path segment, e.g. "1.0.0" for `canvas@1.0.0`. */
  version: string;
  /** SPDX id, e.g. "MIT", "LGPL-3.0-or-later". */
  license: string;
  marker: EngineMarker;
  location: EngineLocation;
  needsIsolation: boolean;
  /** True for engines that get a pinned worker with an idle TTL, terminated to reclaim wasm heap. */
  heavy: boolean;
  supports(op: Operation, input: FormatId, output: FormatId): boolean;
  load(ctx: EngineLoadContext): Promise<EngineInstance>;
}
