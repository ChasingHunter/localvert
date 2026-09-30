import type {
  Capabilities,
  EngineId,
  Operation,
  StepFormat,
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
 * directory; `to` is the filename it lands as under `public/engines/<id>--<
 * version>/` (static) or `.engines-r2/xl/<id>--<version>/` (r2).
 *
 * `package` overrides the engine's own top-level `package` for this one
 * file — for an engine whose assets are split across several npm packages
 * (e.g. `tesseract`: the `tesseract.js` package ships the JS glue, while
 * `tesseract.js-core` ships the wasm and `@tesseract.js-data/eng` ships the
 * language data). Omitted, `from` resolves against the engine's own
 * `package` as before. `sync-engines`'s installed-version check only ever
 * runs against the engine's own `package`/`version` pair — a file borrowed
 * from a different package is copied as-is, unchecked against any version.
 *
 * `package: "local"` is a sentinel, not a real npm specifier: `from`
 * resolves relative to the repo root's own `vendor/` tree instead of any
 * installed package — for assets with no owning npm package at all (e.g.
 * `typst`'s vendored OFL/Bitstream-Vera fonts and its vendored `cmarker`
 * typst package, fetched once at dev time per its ADR, not installed via
 * npm).
 */
export interface EngineSourceFile {
  from: string;
  to: string;
  package?: string;
  /**
   * Ship this file gzipped (`to` must itself end in `.gz`) instead of
   * copying it raw — `scripts/sync-engines.ts` compresses it (node `zlib`,
   * level 9, deterministic) and `scripts/gen-registry.ts` sizes the
   * compressed bytes, not the source file's. Used for typst's compiler wasm
   * (28 MB -> ~10 MB) so it ships as a "static" asset without a download-
   * consent gate — see docs/adr/0011-typst-markdown-to-pdf.md. The adapter
   * that fetches a `gzip` file is responsible for decompressing it itself
   * (`DecompressionStream("gzip")`); nothing in `public/_headers`/infra
   * declares `Content-Encoding` for `/engines/*`.
   */
  gzip?: boolean;
  /**
   * Apply a named, deterministic source transform to this file while
   * copying it, instead of copying it byte-for-byte. `"typst-glue"` —
   * `patchTypstGlue` in `scripts/sync-engines.ts` — replaces the two
   * `new Function(...)` stubs wasm-bindgen's glue embeds for typst's dummy
   * AccessModel/Registry with a closed lookup table, so the file runs under
   * this app's CSP (no `unsafe-eval`). See that function's doc comment and
   * ADR-0011.
   *
   * `"libreoffice-glue"` — `patchLibreOfficeGlue` in
   * `scripts/sync-engines.ts` — (1) replaces embind's two runtime code-
   * generation sites (`craftInvokerFunction`'s invoker, and the emval method
   * caller in `__emval_get_method_caller`) with the eval-free closures
   * Emscripten itself emits under `-sDYNAMIC_EXECUTION=0`, so soffice.js's
   * bound-class methods run under this app's CSP too; (2) raises the
   * prespawned pthread pool so Calc's import doesn't deadlock waiting on a
   * Worker that can't start. See those functions' doc comments and ADR-0012.
   */
  patch?: "typst-glue" | "libreoffice-glue";
}

/**
 * Where an engine's assets live. "native" means the engine wraps a browser
 * API and ships no assets of its own — see `EngineLoadContext.baseUrl`.
 * "bundled" means pure JS shipped inside the engine's own worker chunk, with
 * no separate assets either — like "native", `package`/`files` are forbidden
 * in its `engine.json` (see `scripts/gen-registry.ts`).
 */
export type EngineLocation = "native" | "static" | "r2" | "bundled";

/**
 * Passed to `EngineAdapter.load`. `baseUrl` is the engine's own asset root,
 * e.g. "/engines/canvas--1.0.0/" — meaningless for a "native" engine, which
 * ignores it.
 */
export interface EngineLoadContext {
  baseUrl: string;
  capabilities: Capabilities;
}

/**
 * The decode → transform → encode raster intermediate ADR-0007's image
 * pipeline passes between steps in one worker, never transferred or cloned.
 * RGBA, 8-bit per channel; `data.length` must equal `width * height * 4`.
 * Pinned to the `ArrayBuffer` type parameter (not the wider `ArrayBufferLike`
 * a bare `Uint8ClampedArray` defaults to) because that's what `ImageData`'s
 * constructor requires — a raster is never backed by a `SharedArrayBuffer`.
 */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export type EngineInput =
  | { kind: "blob"; blob: Blob }
  | { kind: "bytes"; bytes: ArrayBuffer }
  | { kind: "opfs"; path: string }
  | { kind: "raster"; image: RasterImage };

/**
 * `op`/`inputFormat`/`outputFormat` follow ADR-0007's raster-pipeline
 * convention: `decode` goes (a real format -> `"raster"`), `encode` goes
 * (`"raster"` -> a real format), `resize`/`rotate`/`crop` go
 * (`"raster"` -> `"raster"`), and a byte-to-byte op like `transcode` goes
 * (a real format -> the same kind of real format on both sides).
 */
export interface EngineTask {
  op: Operation;
  input: EngineInput;
  /**
   * ADR-0008: set only on a many-to-one step (e.g. `merge`) — every input in
   * the user's own order, `input` above being the first of them again. Every
   * other op reads `input` alone and ignores this.
   */
  inputs?: readonly EngineInput[];
  inputFormat: StepFormat;
  outputFormat: StepFormat;
  options: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
  /** 0..1. The caller throttles; an adapter may call this as often as it likes. */
  onProgress?: (fraction: number) => void;
}

export type EngineResult =
  | {
      kind: "bytes";
      bytes: ArrayBuffer;
      mime: string;
      /**
       * ADR-0013: set when a compress tool's own never-larger-than-input
       * check (`src/lib/engines/shared/never-larger.ts`) fell back to
       * returning the input unchanged — surfaced on the job card via
       * `job-engine.ts`'s `applyResult` and `Job.output.note`. Every other
       * op leaves this unset.
       */
      note?: string;
    }
  | { kind: "stream"; stream: ReadableStream<Uint8Array>; mime: string }
  | {
      kind: "opfs";
      path: string;
      mime: string;
      size: number;
      /**
       * ADR-0017: a target-size/percent compress mode's own result-contract
       * note ("19.4 MB, 97% of your 20 MB target.", "The smallest we could
       * make it is 23 MB.") — set the same way the `"bytes"` kind's `note`
       * above is, just on the OPFS path a large audio/video output takes
       * instead (ADR-0010). `job-engine.ts`'s `applyResult` surfaces it the
       * same way for both kinds.
       */
      note?: string;
    }
  | { kind: "raster"; image: RasterImage }
  /**
   * ADR-0008: a one-to-many step's output (e.g. `split`) — every produced
   * file, named by the engine (`job-engine.ts` uses these names as-is,
   * de-duplicated by the existing zip-name logic). Every buffer here is
   * transferred, never copied — see `transferablesOf` in
   * `src/lib/workers/engine-host.ts`.
   */
  | {
      kind: "files";
      files: { name: string; bytes: ArrayBuffer; mime: string }[];
    };

export interface EngineInstance {
  run(task: EngineTask): Promise<EngineResult>;
  dispose(): void;
}

export interface EngineAdapter {
  id: EngineId;
  /** Must match the asset path segment, e.g. "1.0.0" for `canvas--1.0.0`. */
  version: string;
  /** SPDX id, e.g. "MIT", "LGPL-3.0-or-later". */
  license: string;
  marker: EngineMarker;
  location: EngineLocation;
  needsIsolation: boolean;
  /** True for engines that get a pinned worker with an idle TTL, terminated to reclaim wasm heap. */
  heavy: boolean;
  supports(op: Operation, input: StepFormat, output: StepFormat): boolean;
  load(ctx: EngineLoadContext): Promise<EngineInstance>;
}
