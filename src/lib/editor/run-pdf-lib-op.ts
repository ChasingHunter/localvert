import type { EngineResult } from "@/lib/engines";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { Operation } from "@/lib/registry";
import { createWorkerPool, spawnEngineWorker } from "@/lib/workers";

/**
 * Runs one `pdf-lib` engine op against a fresh, single-worker pool spun up
 * for this one call and torn down right after — the same machinery
 * `ToolRunner` uses (`createWorkerPool` + `spawnEngineWorker`,
 * `src/lib/workers`), just without going through `JobEngine`/the job store,
 * which is that flow's user-visible upload-a-file-see-a-progress-bar UI.
 * This is for internal editor steps that have no business appearing in it —
 * originally `flattenExportedForms` (E2a), now shared with the page
 * organizer's `organize` op (E3). See `flattenExportedForms`'s previous doc
 * comment (still true) for why `pdf-lib` in particular needs no pinned
 * worker: it's a `heavy: false`, `kind: "job"` engine with no wasm to keep
 * warm (see `ENGINE_MANIFEST["pdf-lib"]`).
 *
 * `inputs` is always passed through, even for a single-input op — see
 * `RunRequest.inputs`'s doc comment: it's read only by a many-to-one op
 * (`merge`, `organize`), everything else ignores it, so passing it
 * unconditionally is harmless and keeps this one call site simple.
 */
async function runPdfLibJob(
  op: Operation,
  inputs: readonly ArrayBuffer[],
  options: Readonly<Record<string, unknown>>,
): Promise<EngineResult> {
  const first = inputs[0];
  if (!first) {
    throw new Error(`pdf-lib op "${op}" requires at least one input`);
  }
  const pool = createWorkerPool({
    size: 1,
    spawn: spawnEngineWorker,
    isHeavy: () => false,
  });
  try {
    const controller = new AbortController();
    return await pool.run(
      {
        jobId: `pdf-lib-${op}`,
        input: { kind: "bytes", bytes: first },
        inputs: inputs.map((bytes) => ({ kind: "bytes", bytes })),
        steps: [
          {
            engine: "pdf-lib",
            baseUrl: ENGINE_MANIFEST["pdf-lib"].baseUrl,
            op,
            inputFormat: "pdf",
            outputFormat: "pdf",
          },
        ],
        options,
      },
      { signal: controller.signal },
    );
  } finally {
    pool.destroy();
  }
}

/** The common case: an op whose result is a single pdf's bytes (`flatten`,
 * `organize`, …). */
export async function runPdfLibOp(
  op: Operation,
  inputs: readonly ArrayBuffer[],
  options: Readonly<Record<string, unknown>> = {},
): Promise<ArrayBuffer> {
  const result = await runPdfLibJob(op, inputs, options);
  if (result.kind !== "bytes") {
    throw new Error(
      `pdf-lib op "${op}" returned unexpected result kind "${result.kind}"`,
    );
  }
  return result.bytes;
}

/**
 * The page organizer (E3) needs to know how many pages a just-inserted PDF
 * has, to lay out one placeholder tile per page — but reading that off the
 * raw bytes is decode work, which invariant 2 forbids on the main thread.
 * `split`'s `mode: "each"` already exists on this same engine and returns
 * one file per page (`EngineResult.files.length` above); reusing it here is
 * a small correctness/simplicity trade rather than adding a dedicated
 * page-count op purely for this — the per-page pdf bytes it produces are
 * simply discarded.
 */
export async function countPdfPages(bytes: ArrayBuffer): Promise<number> {
  const result = await runPdfLibJob("split", [bytes], { mode: "each" });
  if (result.kind !== "files") {
    throw new Error(
      `pdf-lib op "split" returned unexpected result kind "${result.kind}"`,
    );
  }
  return result.files.length;
}
