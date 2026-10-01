/**
 * `@ffmpeg/core`'s published ESM glue (`dist/esm/ffmpeg-core.js`, GPL-2.0-or-
 * later — see ADR-0002) resolves `ffmpeg-core.wasm` relative to its own
 * `import.meta.url` unless its factory's `locateFile` hook overrides that —
 * confirmed by reading the published source (`_locateFile` calls
 * `Module["locateFile"]` when set, before falling back to
 * `new URL("ffmpeg-core.wasm", import.meta.url)`). Bundled through a static
 * `import`, that URL would resolve to wherever the bundler places the
 * package's chunk, not to this engine's own `ctx.baseUrl` — invariant 3
 * territory (no engine in the core bundle; every engine's asset must be
 * fetched from its own versioned, same-origin path), and unversioned
 * besides. Unlike `libraw`'s glue, this file has no `new Worker(...)` of its
 * own (grepped the installed package: zero matches) — the JS glue is loaded
 * at runtime purely to keep its own `import.meta.url` pointed at
 * `ctx.baseUrl` (via `locateFile`), the same reasoning as `libraw/
 * adapter.ts`'s `load()`, not because it would hang Turbopack the way
 * `libraw.js`'s self-referencing worker did.
 *
 * The factory (`export default createFFmpegCore`) exposes `exec(...args) ->
 * number` (0 on success), `ffprobe`, `FS` (Emscripten's MEMFS —
 * `writeFile`/`readFile`/`unlink`), `setLogger`, `setProgress`, `setTimeout`,
 * `reset`, and `ret` (the last exec's exit code) — read directly off the
 * published `dist/esm/ffmpeg-core.js` source, which ships no `.d.ts`.
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

interface FFmpegFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
}

interface FFmpegModule {
  FS: FFmpegFS;
  exec(...args: string[]): number;
  setLogger(logger: (entry: { type: string; message: string }) => void): void;
  setProgress(handler: (p: { progress: number; time: number }) => void): void;
  reset(): void;
  ret: number;
}

interface FFmpegFactoryOptions {
  /**
   * Overrides where the module fetches `ffmpeg-core.wasm` from. Without it,
   * the module resolves the wasm relative to this file's own
   * `import.meta.url` — exactly what this adapter must avoid, per invariant
   * 3 (no CDN, and the wasm must come from this engine's own `ctx.baseUrl`).
   */
  locateFile?: (path: string, prefix: string) => string;
}

type CreateFFmpegModule = (
  options?: FFmpegFactoryOptions,
) => Promise<FFmpegModule>;

/**
 * `engine.json` is the single source of truth for this adapter's metadata —
 * see the identical cast in `../libraw/adapter.ts`. ADR-0002 governs this
 * engine specifically: `@ffmpeg/core` wraps FFmpeg built with x264, GPL-2.0-
 * or-later — the first engine this repo ships under that ADR's rules. Rule
 * 3 ("separate execution context") is met by `heavy: true`: `src/lib/
 * workers/pool.ts` gives every heavy engine its own dedicated worker outside
 * the shared light pool (see `pool.test.ts`'s "gives each heavy engine its
 * own worker outside the light pool's size cap"), so no other engine's code
 * ever shares this worker's execution context. Rule 4 ("fetched at runtime,
 * on demand") is met by `location: "r2"` (this engine's wasm is ~31 MB,
 * downloaded only when a user drops an avi/wmv/flv file) plus the download
 * consent gate in front of it. Rule 2 ("unmodified upstream artifacts
 * only") is met by shipping `@ffmpeg/core`'s published `dist/esm/*` files
 * as-is — no patch, no recompile.
 */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  // engine.json has no "version" for this engine (derived from its
  // installed npm package) -- pnpm gen resolves the real value into
  // manifest.ts, which this reads at build time. See docs/ENGINES.md,
  // "How engine assets ship".
  version: ENGINE_MANIFEST.ffmpeg.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/**
 * This is a single-thread (non "-mt") ffmpeg core: the whole input file is
 * held in wasm linear memory at once (MEMFS `writeFile`), with no streaming
 * decode. Capped well under wasm's 4 GiB address-space ceiling — and under
 * what's realistic to hold twice over (input + working buffers) in a
 * browser tab — rather than letting a huge legacy-container file fail deep
 * inside ffmpeg with an opaque abort.
 */
export const MAX_INPUT_BYTES = 1024 * 1024 * 1024; // 1 GiB

const LEGACY_EXT: Record<string, string> = {
  avi: "avi",
  wmv: "wmv",
  flv: "flv",
  wma: "wma",
};

/**
 * Every legacy container here transcodes to mp4 (video) or, for the
 * "x-to-mp3" tools, to mp3 (audio extracted, video dropped). `wma` is
 * audio-only (no video track to remux into mp4), so it only goes to mp3.
 * Same reasoning as `wmv-to-mp4`'s own doc comment for why this needs
 * ffmpeg at all: WMA's codec (wmav1/wmav2) isn't one WebCodecs decodes.
 * Confirmed ffmpeg-core's build includes both a wmav1/wmav2 decoder and a
 * libmp3lame encoder by grepping the installed `@ffmpeg/core` wasm for
 * those strings. One run does the extract and the mp3 encode together.
 */
function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  if (op !== "transcode" || !(input in LEGACY_EXT)) return false;
  if (input === "wma") return output === "mp3";
  return output === "mp4" || output === "mp3";
}

/** Reads `task.input` down to the bytes ffmpeg's MEMFS wants. */
async function inputToBytes(input: EngineInput): Promise<Uint8Array> {
  switch (input.kind) {
    case "blob":
      return new Uint8Array(await input.blob.arrayBuffer());
    case "bytes":
      return new Uint8Array(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "ffmpeg engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "ffmpeg expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  // @vite-ignore — vitest's browser mode is Vite-powered; same reasoning as
  // the two directives below, for the bundler this file's own tests run
  // under. See this file's top doc comment and `../libraw/adapter.ts`'s
  // `load()` for why this import must never be statically resolved.
  const imported = (await import(
    /* webpackIgnore: true */
    /* turbopackIgnore: true */
    /* @vite-ignore */
    `${ctx.baseUrl}ffmpeg-core.js`
  )) as { default: CreateFFmpegModule };
  const createFFmpegModule = imported.default;
  const module = await createFFmpegModule({
    locateFile: (path) => `${ctx.baseUrl}${path}`,
  });
  return {
    run: (task) => run(task, module),
    dispose: () => dispose(module),
  };
}

async function run(
  task: EngineTask,
  module: FFmpegModule,
): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "transcode":
        return await runTranscode(task, module);
      default:
        throw new EngineError(
          "unsupported",
          `ffmpeg cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * transcode: a legacy container (avi/wmv/flv) -> mp4, re-encoded to
 * AVC/AAC, or (and always for `wma`) -> mp3, audio-only — these containers carry codecs
 * (mpeg4/wmv/flv1/wma, mp3/wma/pcm) WebCodecs (mediabunny's path) doesn't
 * decode, which is why this tool reaches ffmpeg at all rather than the
 * permissive path (ADR-0002).
 */
async function runTranscode(
  task: EngineTask,
  module: FFmpegModule,
): Promise<EngineResult> {
  const { input, inputFormat, outputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  const bytes = await inputToBytes(input);
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new EngineError(
      "unsupported",
      `file too large for the legacy-video engine (${(bytes.byteLength / (1024 * 1024)).toFixed(0)} MB exceeds the ${MAX_INPUT_BYTES / (1024 * 1024 * 1024)} GiB cap)`,
      { engine: metadata.id },
    );
  }
  signal.throwIfAborted();

  const ext = LEGACY_EXT[inputFormat];
  if (!ext) {
    throw new EngineError(
      "unsupported",
      `ffmpeg cannot transcode input format "${inputFormat}"`,
      { engine: metadata.id },
    );
  }
  // mp3 output means audio-only (wma always, the others for "x-to-mp3") —
  // see `supports`'s own doc comment.
  const audioOnly = outputFormat === "mp3";
  const inPath = `/in.${ext}`;
  const outPath = audioOnly ? "/out.mp3" : "/out.mp4";

  const logLines: string[] = [];
  module.setLogger(({ message }) => {
    logLines.push(message);
    if (logLines.length > 200) logLines.shift();
  });
  module.setProgress(({ progress }) => {
    if (Number.isFinite(progress) && progress >= 0) {
      onProgress?.(Math.min(progress, 1));
    }
  });

  module.FS.writeFile(inPath, bytes);
  try {
    signal.throwIfAborted();
    const code = audioOnly
      ? module.exec(
          "-i",
          inPath,
          "-vn",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "192k",
          outPath,
        )
      : module.exec(
          "-i",
          inPath,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          outPath,
        );
    if (code !== 0) {
      throw new EngineError(
        "encode-failed",
        `ffmpeg exited with code ${code}: ${logLines.slice(-20).join("\n")}`,
        { engine: metadata.id },
      );
    }
    signal.throwIfAborted();

    const out = module.FS.readFile(outPath);
    onProgress?.(1);
    // Copy out of the wasm heap's own buffer before returning — `readFile`'s
    // `Uint8Array` is a view over MEMFS-owned memory that `unlink`/the next
    // `exec` can invalidate or overwrite.
    const outBytes = out.slice().buffer as ArrayBuffer;
    return {
      kind: "bytes",
      bytes: outBytes,
      mime: audioOnly ? "audio/mpeg" : "video/mp4",
    };
  } finally {
    // Best-effort cleanup — a failed exec may not have produced outPath.
    try {
      module.FS.unlink(inPath);
    } catch {
      // already gone or never written
    }
    try {
      module.FS.unlink(outPath);
    } catch {
      // exec failed before producing output
    }
    module.reset();
  }
}

function dispose(module: FFmpegModule): void {
  // No engine-owned resource persists between `run()` calls beyond what
  // `runTranscode`'s own `finally` already cleans up (MEMFS files, ret/
  // timeout via `reset()`). Reclaiming the wasm heap itself requires
  // terminating the worker that hosts this instance — the same constraint
  // every other Emscripten-built engine here has (see libraw's `dispose`).
  module.reset();
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:ffmpeg",
  supports,
  load,
});
