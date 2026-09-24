import * as Comlink from "comlink";
import { createZipSink } from "@/lib/sinks/zip";

/**
 * Zips a batch of already-converted blobs into a streaming zip. Runs inside
 * its own worker (spawned per call by `zipInWorker` in `spawn.ts`) so zipping
 * — like every other decode/encode/zip step — never happens on the main
 * thread (invariant 2).
 *
 * Typechecked by `tsconfig.worker.json` (WebWorker lib, no DOM) — see
 * ADR-0005. Imports `./zip` directly rather than the `@/lib/sinks` barrel to
 * avoid pulling in `fs-access.ts`, which is main-thread only.
 */

function zip(
  entries: { name: string; blob: Blob }[],
): ReadableStream<Uint8Array> {
  // Media is already compressed (jpeg, mp4, ...) — re-deflating it would
  // just burn CPU for no size win, so entries are stored, not compressed.
  const sink = createZipSink();

  // Returns `sink.stream` before this finishes — entries are added in the
  // background, gated by the stream's own backpressure (see createZipSink's
  // doc comment), so a slow/absent consumer never causes entries to buffer
  // fully in memory.
  (async () => {
    try {
      for (const entry of entries) {
        await sink.add({ name: entry.name, data: entry.blob, compress: false });
      }
      await sink.finish();
    } catch (e) {
      sink.abort(e);
    }
  })();

  return Comlink.transfer(sink.stream, [sink.stream]);
}

Comlink.expose({ zip });
