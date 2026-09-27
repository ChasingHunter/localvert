/**
 * `@bentopdf/libreoffice-wasm` (MPL-2.0) ships LibreOfficeDev 24.8 built to
 * wasm/pthreads via Emscripten. See docs/adr/0012-libreoffice-office-to-pdf.md
 * for why this engine exists (fidelity a lightweight docx/xlsx parser can't
 * match) and its provenance/CSP/memory tradeoffs.
 *
 * Unlike every other engine here, this one's "glue" is not loaded by
 * `import()` in this worker at all: the package ships its own classic worker
 * (`browser.worker.global.js`, read directly — no `.d.ts`, no README) that
 * does the Emscripten instantiation and LibreOfficeKit driving *itself*, in
 * its *own* nested worker. This adapter's job is narrower: fetch this
 * engine's gzipped wasm/data assets from `ctx.baseUrl`, decompress them to
 * blob URLs (nothing in `public/_headers`/infra declares `Content-Encoding`
 * for `/engines/*` — same reasoning as `../typst/adapter.ts`'s
 * `fetchGzippedBytes`), spawn that nested worker, and speak its postMessage
 * protocol (confirmed by reading `browser.worker.global.js` directly):
 *
 *   -> {type:"init", id, sofficeJs, sofficeWasm, sofficeData, sofficeWorkerJs,
 *       enableProgressTracking}
 *   <- {type:"ready", id}                                   (once)
 *   -> {type:"convert", id, inputData, inputExt, outputFormat, filterOptions?,
 *       password?}
 *   <- {type:"progress", id, progress:{percent, message}}   (zero or more)
 *   <- {type:"result", id, data: Uint8Array}                (success)
 *   <- {type:"error", id, error: string}                    (failure)
 *
 * `worker-src 'self' blob:` (public/_headers) permits both the same-origin
 * `browser.worker.global.js` worker script and the blob-URL wasm/data it
 * fetches internally.
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

/**
 * `engine.json` is the single source of truth for this adapter's metadata —
 * see the identical cast in `../ffmpeg/adapter.ts`.
 */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  version: ENGINE_MANIFEST.libreoffice.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/** Extension the nested worker's `MimetypeConverter` (see `q`'s filter-name
 * table in `browser.worker.global.js`) needs to pick the right import
 * filter — every format this tool accepts, all converting to "pdf". */
const INPUT_EXT: Record<string, string> = {
  docx: "docx",
  doc: "doc",
  odt: "odt",
  rtf: "rtf",
  xlsx: "xlsx",
  xls: "xls",
  ods: "ods",
  pptx: "pptx",
  ppt: "ppt",
  odp: "odp",
};

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return op === "transcode" && input in INPUT_EXT && output === "pdf";
}

/** How long `init` may take before this adapter gives up — LibreOffice's own
 * boot (decompressing ~74 MB, then Emscripten instantiation) is slow, not
 * hung, well past any other engine's load time here. */
const INIT_TIMEOUT_MS = 180_000;

/**
 * ADR-0012: this build has no desktop-memory floor built into it, so a low-
 * memory device (tablet, budget phone) can OOM partway through boot with an
 * opaque wasm abort. `navigator.deviceMemory` (Chromium-only; `undefined`
 * elsewhere, e.g. Firefox/Safari) is a coarse, self-reported approximation —
 * this only refuses the *known*-too-small case, never claims the inverse.
 */
const MIN_DEVICE_MEMORY_GIB = 4;

/** Exported for `adapter.test.ts` — pure enough to unit-test without a real
 * `navigator`/wasm heap. */
export function checkDeviceMemory(): void {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (
    typeof nav.deviceMemory === "number" &&
    nav.deviceMemory < MIN_DEVICE_MEMORY_GIB
  ) {
    throw new EngineError(
      "unsupported",
      "Office conversion needs a desktop browser with at least 4 GB of memory",
      { engine: metadata.id },
    );
  }
}

/** True for the handful of ways a wasm/JS heap allocation failure surfaces —
 * `RangeError` from a failed `WebAssembly.Memory` grow, or Emscripten's own
 * "out of memory" abort message. Mapped to the same guidance as the
 * pre-flight `deviceMemory` check: this device just doesn't have enough. */
export function isOutOfMemory(e: unknown): boolean {
  if (e instanceof RangeError) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /out of memory/i.test(message);
}

async function fetchBytes(
  ctx: EngineLoadContext,
  file: string,
): Promise<Uint8Array> {
  const res = await fetch(`${ctx.baseUrl}${file}`);
  if (!res.ok) {
    throw new EngineError(
      "load-failed",
      `failed to fetch libreoffice asset "${file}" (${res.status})`,
      { engine: metadata.id },
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Gunzips one of this engine's `.gz` assets straight to a `blob:` URL — the
 * nested worker's own Emscripten glue fetches this URL itself, so handing it
 * already-decompressed bytes is what lets that internal fetch "just work"
 * with no `Content-Encoding` support anywhere in this app's infra. */
async function fetchGzippedBlobUrl(
  ctx: EngineLoadContext,
  file: string,
  mime: string,
): Promise<string> {
  const bytes = await fetchBytes(ctx, file);
  const stream = new Response(
    bytes.slice().buffer as ArrayBuffer,
  ).body?.pipeThrough(new DecompressionStream("gzip"));
  if (!stream) {
    throw new EngineError(
      "internal",
      `no response body stream to decompress for "${file}"`,
      { engine: metadata.id },
    );
  }
  const blob = await new Response(stream).blob();
  return URL.createObjectURL(new Blob([blob], { type: mime }));
}

interface ProgressMessage {
  type: "progress";
  id: string;
  progress: { percent: number; message: string };
}
interface ResultMessage {
  type: "result";
  id: string;
  data: Uint8Array;
}
interface ErrorMessage {
  type: "error";
  id: string;
  error: string;
}
interface ReadyMessage {
  type: "ready";
  id: string;
}
type WorkerMessage =
  | ProgressMessage
  | ResultMessage
  | ErrorMessage
  | ReadyMessage;

/** The nested classic worker, initialized once and reused for every `run()`
 * call this engine worker handles — see this file's top doc comment. */
interface NestedWorker {
  worker: Worker;
  nextId: number;
}

/**
 * Spawns `browser.worker.global.js` as a same-origin classic `Worker` and
 * drives its init handshake. Every asset URL is same-origin or `blob:`
 * (never a cross-origin CDN), matching `worker-src 'self' blob:`.
 */
async function initNestedWorker(ctx: EngineLoadContext): Promise<NestedWorker> {
  checkDeviceMemory();

  let wasmUrl: string | undefined;
  let dataUrl: string | undefined;
  try {
    [wasmUrl, dataUrl] = await Promise.all([
      fetchGzippedBlobUrl(ctx, "soffice.wasm.gz", "application/wasm"),
      fetchGzippedBlobUrl(ctx, "soffice.data.gz", "application/octet-stream"),
    ]);

    const worker = new Worker(`${ctx.baseUrl}browser.worker.global.js`);

    const ready = await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new EngineError(
            "load-failed",
            "libreoffice engine did not become ready within 180s",
            { engine: metadata.id },
          ),
        );
      }, INIT_TIMEOUT_MS);

      function onMessage(e: MessageEvent<WorkerMessage>): void {
        const msg = e.data;
        if (msg.id !== "init") return;
        if (msg.type === "ready") {
          cleanup();
          resolve();
        } else if (msg.type === "error") {
          cleanup();
          reject(
            new EngineError("load-failed", msg.error, { engine: metadata.id }),
          );
        }
      }
      function onError(e: ErrorEvent): void {
        cleanup();
        reject(
          new EngineError(
            "load-failed",
            `libreoffice worker failed to start: ${e.message}`,
            { engine: metadata.id },
          ),
        );
      }
      function cleanup(): void {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      }

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({
        type: "init",
        id: "init",
        sofficeJs: `${ctx.baseUrl}soffice.js`,
        sofficeWasm: wasmUrl,
        sofficeData: dataUrl,
        sofficeWorkerJs: `${ctx.baseUrl}soffice.worker.js`,
        enableProgressTracking: true,
      });
    });
    void ready;

    return { worker, nextId: 0 };
  } catch (e) {
    if (isOutOfMemory(e)) {
      throw new EngineError(
        "unsupported",
        "Office conversion needs a desktop browser with at least 4 GB of memory",
        { engine: metadata.id, cause: e },
      );
    }
    throw e;
  } finally {
    // The nested worker's own Emscripten glue has already fetched these blob
    // URLs by the time `ready`/`error` arrives (or never will, on a hard
    // failure) — safe to revoke either way.
    if (wasmUrl) URL.revokeObjectURL(wasmUrl);
    if (dataUrl) URL.revokeObjectURL(dataUrl);
  }
}

async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  // Lazily initialized on the first `run()` call, then cached for the life
  // of this engine worker — booting LibreOffice on every job would waste the
  // ~74 MB download and the wasm instantiation on every single conversion.
  let cached: NestedWorker | null = null;

  return {
    run: (task) =>
      run(
        task,
        ctx,
        () => cached,
        (w) => (cached = w),
      ),
    dispose: () => {
      cached?.worker.terminate();
      cached = null;
    },
  };
}

function inputToBytes(input: EngineInput): Promise<Uint8Array> | Uint8Array {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer().then((b) => new Uint8Array(b));
    case "bytes":
      return new Uint8Array(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "libreoffice engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "libreoffice expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

async function run(
  task: EngineTask,
  ctx: EngineLoadContext,
  getCached: () => NestedWorker | null,
  setCached: (w: NestedWorker | null) => void,
): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "transcode":
        return await runTranscode(task, ctx, getCached, setCached);
      default:
        throw new EngineError(
          "unsupported",
          `libreoffice cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

async function runTranscode(
  task: EngineTask,
  ctx: EngineLoadContext,
  getCached: () => NestedWorker | null,
  setCached: (w: NestedWorker | null) => void,
): Promise<EngineResult> {
  const { input, inputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  const inputExt = INPUT_EXT[inputFormat];
  if (!inputExt) {
    throw new EngineError(
      "unsupported",
      `libreoffice cannot convert input format "${inputFormat}"`,
      { engine: metadata.id },
    );
  }

  let nested = getCached();
  if (!nested) {
    nested = await initNestedWorker(ctx);
    setCached(nested);
  }
  signal.throwIfAborted();

  const inputData = await inputToBytes(input);
  const requestId = `job-${nested.nextId++}`;
  const { worker } = nested;

  return new Promise<EngineResult>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      worker.terminate();
      setCached(null);
      reject(
        new EngineError("aborted", "conversion aborted", {
          engine: metadata.id,
        }),
      );
    };

    function onMessage(e: MessageEvent<WorkerMessage>): void {
      const msg = e.data;
      if (msg.id !== requestId) return;
      if (msg.type === "progress") {
        const fraction = msg.progress.percent / 100;
        if (Number.isFinite(fraction)) {
          onProgress?.(Math.max(0, Math.min(1, fraction)));
        }
      } else if (msg.type === "result") {
        cleanup();
        onProgress?.(1);
        const bytes = msg.data.slice().buffer as ArrayBuffer;
        resolve({ kind: "bytes", bytes, mime: "application/pdf" });
      } else if (msg.type === "error") {
        cleanup();
        reject(
          new EngineError("encode-failed", msg.error, { engine: metadata.id }),
        );
      }
    }
    function onError(e: ErrorEvent): void {
      cleanup();
      setCached(null);
      reject(
        new EngineError(
          "internal",
          `libreoffice worker crashed: ${e.message}`,
          { engine: metadata.id },
        ),
      );
    }
    function cleanup(): void {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    }

    signal.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(
      {
        type: "convert",
        id: requestId,
        inputData,
        inputExt,
        outputFormat: "pdf",
      },
      [inputData.buffer],
    );
  });
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:libreoffice",
  supports,
  load,
});
