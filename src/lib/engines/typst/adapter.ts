/**
 * typst.ts (Apache-2.0) compiles our own generated `/main.typ` (`template.ts`)
 * — page setup, the vendored `cmarker` package, and the dropped markdown —
 * to a PDF, fully offline. See docs/adr/0011-typst-markdown-to-pdf.md.
 *
 * This adapter talks to the **raw** `@myriaddreamin/typst-ts-web-compiler`
 * bindings (`TypstCompilerBuilder`/`TypstCompiler`/`TypstCompileWorld`, read
 * directly off the package's own `pkg/typst_ts_web_compiler.d.ts`), never the
 * higher-level `@myriaddreamin/typst.ts` wrapper package. That wrapper's own
 * `compiler.mjs` contains a bare `import('@myriaddreamin/typst-ts-web-
 * compiler')` (its `getWrapper` escape hatch only skips *calling* that
 * import, not the bundler tracing into it) — a static import site a bundler
 * resolves at build time regardless of which runtime branch executes,
 * exactly the `libraw`/`ffmpeg` "self-referencing asset" problem those
 * adapters' doc comments describe, but for a 28 MB wasm file instead of a
 * self-referencing worker. Reimplementing the small slice of wrapper logic
 * this tool needs directly against the raw bindings (confirmed correct by
 * reading `@myriaddreamin/typst.ts`'s own `compiler.mjs`/`options.init.mjs`
 * source — every call below mirrors what that wrapper does internally)
 * avoids importing that package at runtime at all.
 *
 * The raw wasm-bindgen glue (`typst_ts_web_compiler.mjs`) and its `.wasm` are
 * `sync-engines`-copied static assets, loaded here at runtime the same way
 * `libraw`/`ffmpeg` load their own glue — see those adapters' `load()` doc
 * comments for why this must be a runtime `import()` with the ignore
 * directives below, never a static import.
 */
import type { Operation, StepFormat } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
} from "../types";
import meta from "./engine.json";
import {
  buildMainTyp,
  CMARKER_LIB_PATH,
  type FontSize,
  INPUT_PATH,
  MAIN_PATH,
  type MarkdownToPdfOptions,
  type PageSize,
} from "./template";

/** The handful of raw bindings this adapter uses — see the module doc
 * comment for why these are hand-typed against `typst_ts_web_compiler.d.ts`
 * rather than imported from either package at runtime. */
interface TypstCompileWorldRaw {
  get_artifact(
    fmt: number,
    diagnosticsFormat: number,
  ): { result?: Uint8Array; diagnostics?: unknown[] } | undefined;
  free(): void;
}

interface TypstCompilerRaw {
  snapshot(
    root: string | null | undefined,
    mainFilePath: string | null | undefined,
    inputs: unknown[] | null | undefined,
  ): TypstCompileWorldRaw;
  free(): void;
}

interface TypstCompilerBuilderRaw {
  set_access_model(
    context: unknown,
    mtimeFn: (path: string) => number,
    isFileFn: (path: string) => boolean,
    realPathFn: (path: string) => string,
    readAllFn: (path: string) => Uint8Array | undefined,
  ): Promise<void>;
  add_raw_font(fontBytes: Uint8Array): Promise<void>;
  build(): Promise<TypstCompilerRaw>;
  free(): void;
}

interface TypstWasmModule {
  TypstCompilerBuilder: new () => TypstCompilerBuilderRaw;
}

/** The glue module's default export — see `typst_ts_web_compiler.d.ts`'s
 * `__wbg_init`. Passing the wasm bytes directly (rather than a URL/Request)
 * skips straight to `WebAssembly.instantiate`, no self-fetch involved. */
type InitWasm = (moduleOrPath?: Uint8Array) => Promise<unknown>;

/**
 * `engine.json` is the single source of truth for this adapter's metadata —
 * see the identical cast in `../libraw/adapter.ts`.
 */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  version: ENGINE_MANIFEST.typst.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

const FONT_FILES = [
  "fonts/LibertinusSerif-Regular.otf",
  "fonts/LibertinusSerif-Bold.otf",
  "fonts/LibertinusSerif-Italic.otf",
  "fonts/LibertinusSerif-BoldItalic.otf",
  "fonts/DejaVuSansMono.ttf",
  "fonts/DejaVuSansMono-Bold.ttf",
] as const;

const CMARKER_PLUGIN_PATH = "/packages/preview/cmarker/0.1.8/plugin.wasm";

const PAGE_SIZES: readonly PageSize[] = ["a4", "letter"];
const FONT_SIZES: readonly FontSize[] = ["10", "11", "12"];

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "transcode" && input === "md" && output === "pdf";
}

function parseOptions(
  options: Readonly<Record<string, unknown>>,
): MarkdownToPdfOptions {
  const pageSize = PAGE_SIZES.includes(options.pageSize as PageSize)
    ? (options.pageSize as PageSize)
    : "a4";
  const fontSize = FONT_SIZES.includes(options.fontSize as FontSize)
    ? (options.fontSize as FontSize)
    : "11";
  return { pageSize, fontSize };
}

async function inputToText(input: EngineInput): Promise<string> {
  switch (input.kind) {
    case "blob":
      return input.blob.text();
    case "bytes":
      return new TextDecoder().decode(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "typst engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "typst expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new EngineError(
      "load-failed",
      `failed to fetch typst asset "${url}" (${res.status})`,
      { engine: metadata.id },
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Same as `fetchBytes`, plus gzip decompression: the compiler wasm ships as
 * `typst_ts_web_compiler_bg.wasm.gz` (ADR-0011) so it fits the "static"
 * asset tier (~10 MB gzipped vs. ~28 MB raw) without a download-consent
 * gate, but nothing in `public/_headers`/`infra` declares `Content-Encoding`
 * for `/engines/*` — the browser never auto-decodes it, so this adapter
 * does. Detected by magic bytes rather than trusting the `.gz` extension:
 * `1F 8B` is gzip; `\0asm` (`00 61 73 6D`) means something upstream (a CDN,
 * a future infra change) already decoded it, in which case the raw bytes
 * are used as-is.
 */
async function fetchGzippedBytes(url: string): Promise<Uint8Array> {
  const bytes = await fetchBytes(url);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Response(
      bytes.slice().buffer as ArrayBuffer,
    ).body?.pipeThrough(new DecompressionStream("gzip"));
    if (!stream) {
      throw new EngineError(
        "internal",
        `no response body stream to decompress for "${url}"`,
        { engine: metadata.id },
      );
    }
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

/**
 * Loaded once per worker: the compiled wasm module, the glue's exported
 * `TypstCompilerBuilder`, and every font/cmarker file's raw bytes. A fresh
 * `TypstCompilerBuilder`/`TypstCompiler` is still built per `run()` call
 * (cheap relative to the one-time wasm instantiation above) since each job
 * compiles different markdown into a fresh in-memory access model.
 */
interface TypstLoaded {
  TypstCompilerBuilder: new () => TypstCompilerBuilderRaw;
  fonts: readonly Uint8Array[];
  cmarkerLib: Uint8Array;
  cmarkerPlugin: Uint8Array;
}

async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  const wasmBytes = await fetchGzippedBytes(
    `${ctx.baseUrl}typst_ts_web_compiler_bg.wasm.gz`,
  );
  // @vite-ignore — vitest's browser mode is Vite-powered; same reasoning as
  // the two directives below, for the bundler this file's own tests run
  // under. See this file's top doc comment and `../libraw/adapter.ts`'s
  // `load()` for why this import must never be statically resolved.
  const glue = (await import(
    /* webpackIgnore: true */
    /* turbopackIgnore: true */
    /* @vite-ignore */
    `${ctx.baseUrl}typst_ts_web_compiler.mjs`
  )) as { default: InitWasm } & TypstWasmModule;
  await glue.default(wasmBytes);

  const [fonts, cmarkerLib, cmarkerPlugin] = await Promise.all([
    Promise.all(FONT_FILES.map((f) => fetchBytes(`${ctx.baseUrl}${f}`))),
    fetchBytes(`${ctx.baseUrl}packages/preview/cmarker/0.1.8/lib.typ`),
    fetchBytes(`${ctx.baseUrl}packages/preview/cmarker/0.1.8/plugin.wasm`),
  ]);

  const loaded: TypstLoaded = {
    TypstCompilerBuilder: glue.TypstCompilerBuilder,
    fonts,
    cmarkerLib,
    cmarkerPlugin,
  };
  return { run: (task) => run(task, loaded), dispose };
}

/**
 * The in-memory "filesystem" one compile sees: `/main.typ` + `/input.md`
 * (this job's own files) plus the vendored cmarker package, at the same
 * absolute paths `template.ts`'s generated source imports/reads. No disk, no
 * network — every path this returns for is one of these four, or nothing.
 */
class MemoryAccessModel {
  private readonly files: ReadonlyMap<string, Uint8Array>;

  constructor(files: ReadonlyMap<string, Uint8Array>) {
    this.files = files;
  }

  isFile(path: string): boolean {
    return this.files.has(path);
  }

  readAll(path: string): Uint8Array | undefined {
    return this.files.get(path);
  }
}

async function run(
  task: EngineTask,
  loaded: TypstLoaded,
): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "transcode":
        return await runTranscode(task, loaded);
      default:
        throw new EngineError(
          "unsupported",
          `typst cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/** transcode: markdown -> pdf, via a fresh `/main.typ` (`template.ts`) per
 * job. See this file's top doc comment for the raw-bindings call sequence
 * (mirrors `@myriaddreamin/typst.ts`'s own `compiler.mjs`, minus the
 * bundler-unsafe import). */
async function runTranscode(
  task: EngineTask,
  loaded: TypstLoaded,
): Promise<EngineResult> {
  const { input, signal, onProgress } = task;
  signal.throwIfAborted();

  const markdown = await inputToText(input);
  const options = parseOptions(task.options);
  const mainTyp = buildMainTyp(options);

  const files = new Map<string, Uint8Array>([
    [MAIN_PATH, new TextEncoder().encode(mainTyp)],
    [INPUT_PATH, new TextEncoder().encode(markdown)],
    [CMARKER_LIB_PATH, loaded.cmarkerLib],
    [CMARKER_PLUGIN_PATH, loaded.cmarkerPlugin],
  ]);
  const accessModel = new MemoryAccessModel(files);
  signal.throwIfAborted();

  const builder = new loaded.TypstCompilerBuilder();
  // `builder.build()` (below) consumes the builder on the Rust side — its
  // own generated JS calls `this.__destroy_into_raw()` internally, same as
  // `free()` does, zeroing out the wrapper's pointer — so once `build()` has
  // been *called* (whether it resolves or rejects), calling `builder.free()`
  // again is a double-free: wasm-bindgen's generated `free()` doesn't guard
  // against an already-zeroed pointer, so a second call panics ("null
  // pointer passed to rust") instead of being a harmless no-op. This flag is
  // what makes the outer `finally` below skip that second call.
  let builderConsumed = false;
  try {
    await builder.set_access_model(
      accessModel,
      () => 0,
      (path) => accessModel.isFile(path),
      (path) => path,
      (path) => accessModel.readAll(path),
    );
    onProgress?.(0.2);

    for (const font of loaded.fonts) {
      await builder.add_raw_font(font);
    }
    signal.throwIfAborted();
    onProgress?.(0.5);

    builderConsumed = true;
    const compiler = await builder.build();
    try {
      const world = compiler.snapshot(undefined, MAIN_PATH, undefined);
      try {
        // fmt 1 = pdf, diagnostics_format 3 = "full" — both taken directly
        // from `@myriaddreamin/typst.ts`'s own `CompileFormatEnum`/
        // `getDiagnosticsArg` (see this file's top doc comment).
        const artifact = world.get_artifact(1, 3);
        if (!artifact?.result) {
          const diagnostics = (artifact?.diagnostics ?? [])
            .map((d) => JSON.stringify(d))
            .join("\n");
          throw new EngineError(
            "encode-failed",
            diagnostics
              ? `typst compile failed:\n${diagnostics}`
              : "typst compile produced no output",
            { engine: metadata.id },
          );
        }
        onProgress?.(1);
        const bytes = artifact.result.slice().buffer as ArrayBuffer;
        return { kind: "bytes", bytes, mime: "application/pdf" };
      } finally {
        world.free();
      }
    } finally {
      compiler.free();
    }
  } finally {
    if (!builderConsumed) builder.free();
  }
}

function dispose(): void {
  // No engine-owned resource persists between `run()` calls — every builder/
  // compiler/world above is freed in its own `finally` block. Reclaiming the
  // wasm heap itself requires terminating the worker that hosts this
  // instance, same as every other Emscripten/wasm-bindgen engine here.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:typst",
  supports,
  load,
});
