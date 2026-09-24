import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { collectToBlob } from "./collect";
import { createZipSink } from "./zip";

// No explicit return type: TextEncoder.encode() returns a Uint8Array backed
// by a fresh, non-shared ArrayBuffer, and annotating this as the bare
// `Uint8Array` type would widen that back to `Uint8Array<ArrayBufferLike>`,
// which `Blob`/`ZipEntry.data` don't accept.
function bytes(s: string) {
  return new TextEncoder().encode(s);
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const blob = await collectToBlob(stream, "application/zip");
  return new Uint8Array(await blob.arrayBuffer());
}

describe("createZipSink", () => {
  it("round-trips Blob, ArrayBuffer and ReadableStream entries, deduping names", async () => {
    const sink = createZipSink();
    const draining = drain(sink.stream);

    const a = bytes("hello blob");
    const b = bytes("hello buffer");
    const c = bytes("hello stream");

    await sink.add({ name: "x.png", data: new Blob([a]) });
    await sink.add({ name: "x.png", data: b.buffer });
    await sink.add({
      name: "y.png",
      data: streamOf([c.slice(0, 5), c.slice(5)]),
    });
    await sink.finish();

    const unzipped = unzipSync(await draining);

    expect(Object.keys(unzipped).sort()).toEqual([
      "x (2).png",
      "x.png",
      "y.png",
    ]);
    expect(unzipped["x.png"]).toEqual(a);
    expect(unzipped["x (2).png"]).toEqual(b);
    expect(unzipped["y.png"]).toEqual(c);
  });

  it("round-trips a compressed entry", async () => {
    const sink = createZipSink();
    const draining = drain(sink.stream);
    const payload = bytes("a".repeat(5000));

    await sink.add({ name: "z.txt", data: payload.buffer, compress: true });
    await sink.finish();

    const unzipped = unzipSync(await draining);
    expect(unzipped["z.txt"]).toEqual(payload);
  });

  it("produces a valid, empty zip when finish() is called with no entries", async () => {
    const sink = createZipSink();
    const draining = drain(sink.stream);

    await sink.finish();

    const unzipped = unzipSync(await draining);
    expect(Object.keys(unzipped)).toEqual([]);
  });
});

describe("createZipSink backpressure", () => {
  it("does not read a large entry's source faster than the consumer drains the output", async () => {
    const sink = createZipSink({ highWaterMarkBytes: 64 * 1024 });

    const chunkSize = 64 * 1024;
    const totalChunks = 64; // 4 MiB total
    let producedChunks = 0;
    let pulledBytes = 0;

    const countingSource = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (producedChunks >= totalChunks) {
          controller.close();
          return;
        }
        producedChunks++;
        const chunk = new Uint8Array(chunkSize);
        pulledBytes += chunk.length;
        controller.enqueue(chunk);
      },
    });

    const addDone = sink.add({ name: "big.bin", data: countingSource });
    let resolved = false;
    addDone.then(
      () => {
        resolved = true;
      },
      () => {
        resolved = true;
      },
    );

    // Let real time pass without ever reading sink.stream.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(resolved).toBe(false);
    expect(pulledBytes).toBeLessThan(4 * 1024 * 1024);

    // Now drain — the stalled add() (and finish() behind it) should
    // complete once the consumer creates room.
    const draining = drain(sink.stream);
    await sink.finish();
    const zipBytes = await draining;

    expect(resolved).toBe(true);
    const unzipped = unzipSync(zipBytes);
    const bigBin = unzipped["big.bin"];
    if (!bigBin) throw new Error("big.bin missing from zip");
    expect(bigBin.length).toBe(chunkSize * totalChunks);
  });
});

describe("createZipSink abort", () => {
  it("errors the stream and rejects a pending add() and finish()", async () => {
    const sink = createZipSink({ highWaterMarkBytes: 1024 });

    const neverEndingSource = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });

    const addPromise = sink.add({ name: "x.bin", data: neverEndingSource });
    // Don't read sink.stream — backpressure stalls add() almost immediately
    // at this high water mark.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const reason = new Error("cancelled by user");
    sink.abort(reason);

    await expect(addPromise).rejects.toBe(reason);
    await expect(sink.finish()).rejects.toBe(reason);
    await expect(sink.stream.getReader().read()).rejects.toBe(reason);
  });
});
