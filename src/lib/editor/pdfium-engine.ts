import { WebWorkerEngine } from "@embedpdf/engines/worker";
import type { PdfEngine } from "@embedpdf/models";
import type {
  TextEditReplaceResult,
  TextEditResultMessage,
  TextObjectInfo,
} from "@/lib/editor/text-edit-protocol";

/**
 * MAIN THREAD. Spawns `pdfium.worker.ts` (our own worker, our own wasm
 * fetch) and wraps it in EmbedPDF's `WebWorkerEngine` — a thin, generic
 * `PdfEngine` proxy over `postMessage`, imported from the `@embedpdf/engines`
 * `./worker` subpath (`dist/lib/webworker/engine.js`), which is deliberately
 * NOT the same module as `pdfium-worker-engine` (that one creates its own
 * blob: worker internally, the thing that hung in E0). This file never
 * imports anything PDFium- or wasm-related itself — only the dynamic
 * `import()` inside `pdfium.worker.ts`, reached exclusively through the `new
 * Worker(new URL(...))` call below, ever touches PDFium (invariants 2 & 3).
 *
 * `new Worker(new URL(...))` must stay exactly this literal shape inline —
 * see the same note in src/lib/workers/spawn.ts.
 *
 * Deliberately outside `src/lib/engines/**` and the job-pipeline
 * `EngineAdapter` contract: a stateful editor session doesn't fit the
 * one-shot `run(task)` shape that contract assumes (see ADR-0009's "app-mode
 * tool kind", still undesigned as of this spike). The wasm asset is also a
 * hand-copied static file rather than an `engine.json`-driven one for the
 * same reason: `pnpm gen` requires `engine.json` and `adapter.ts` to be
 * added together, and there is no adapter for a tool kind that doesn't exist
 * yet. Both are called out as follow-up work in
 * docs/editor/EMBEDPDF_NOTES.md.
 */
/** Rejects a `textEdit` call that never got a reply — a stuck worker or an
 * `objectIndex`/`documentId` mismatch should surface as an error, never a
 * silent hang (per the E5 brief). */
const TEXT_EDIT_TIMEOUT_MS = 10_000;

let nextTextEditRequestId = 0;

/** A small typed client for the `localvert:text` protocol
 * (`text-edit-protocol.ts`) — the raw-PDFium text-editing ops
 * `pdfium.worker.ts` answers on its own `self.addEventListener("message",
 * ...)` channel, separate from `EngineRunner`'s `WebWorkerEngine` protocol
 * above. Talks to the SAME worker instance (one `postMessage` channel, two
 * independent request/response protocols living on it). */
export interface TextEditClient {
  list(documentId: string, pageIndex: number): Promise<TextObjectInfo[]>;
  replace(
    documentId: string,
    pageIndex: number,
    objectIndex: number,
    newText: string,
  ): Promise<TextEditReplaceResult>;
}

function createTextEditClient(worker: Worker): TextEditClient {
  function send<T>(request: Record<string, unknown>): Promise<T> {
    const id = `text-edit-${nextTextEditRequestId++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener("message", onMessage);
        reject(new Error(`localvert:text — request "${id}" timed out`));
      }, TEXT_EDIT_TIMEOUT_MS);
      function onMessage(event: MessageEvent) {
        const data = event.data as TextEditResultMessage | undefined;
        if (data?.type !== "localvert:text:result" || data.id !== id) {
          return;
        }
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        if (data.ok) resolve(data.value as T);
        else reject(new Error(data.error ?? "localvert:text — unknown error"));
      }
      worker.addEventListener("message", onMessage);
      worker.postMessage({ type: "localvert:text", id, ...request });
    });
  }

  return {
    list: (documentId, pageIndex) =>
      send({ op: "list", documentId, pageIndex }),
    replace: (documentId, pageIndex, objectIndex, newText) =>
      send({ op: "replace", documentId, pageIndex, objectIndex, newText }),
  };
}

export function createPdfiumWorkerEngine(): {
  engine: PdfEngine;
  textEdit: TextEditClient;
  /**
   * Resolves once `pdfium.worker.ts` has actually finished fetching +
   * initializing wasm and called `EngineRunner.ready()` — the point where
   * the worker's `self.onmessage` is first installed (see that file's
   * `listen()`/`ready()`, called together). `WebWorkerEngine` proxies every
   * method call (`openDocumentBuffer` included) as a bare `postMessage` with
   * NO wait for readiness on the caller's side; a message sent before the
   * worker installs its listener is simply never received (there is no
   * built-in queueing), and the caller then waits forever for a response
   * that will never come — no error, no rejection, just a permanent hang.
   * Under normal use the worker's fetch is fast enough that nothing ever
   * calls into the engine inside that window, but the window only shrinks,
   * it never closes — anything that opens a document (or otherwise calls
   * the engine) MUST await this first. See the wait in `pdf-editor-app.tsx`.
   */
  ready: Promise<void>;
  terminate(): void;
} {
  const worker = new Worker(new URL("./pdfium.worker.ts", import.meta.url), {
    type: "module",
    // NOT `localvert-engine:pdfium` (colon-suffixed) — that exact shape is
    // `scripts/check-sizes.ts`'s engine-adapter marker convention (invariant
    // 3), reserved for code that must NEVER appear in a page's first load at
    // all. This is legitimate main-thread glue (the same role as
    // `spawn.ts`'s `name: "localvert-engine"`, also deliberately
    // non-colon-suffixed) — it's expected to be reachable from the editor's
    // own lazily-loaded chunk, just not from every OTHER page. See this
    // file's own doc comment above and docs/editor/EMBEDPDF_NOTES.md.
    name: "localvert-pdfium",
  });
  const engine = new WebWorkerEngine(worker);
  return {
    engine,
    textEdit: createTextEditClient(worker),
    ready: engine.readyTask.toPromise().then(() => undefined),
    terminate() {
      worker.terminate();
    },
  };
}
