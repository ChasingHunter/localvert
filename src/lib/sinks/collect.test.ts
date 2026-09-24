import { describe, expect, it } from "vitest";
import { collectToBlob } from "./collect";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("collectToBlob", () => {
  it("concatenates chunks into a single Blob of the given type", async () => {
    const stream = streamOf([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5]),
    ]);
    const blob = await collectToBlob(stream, "application/octet-stream");
    expect(blob.type).toBe("application/octet-stream");
    expect(blob.size).toBe(5);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns an empty Blob for an empty stream", async () => {
    const blob = await collectToBlob(streamOf([]), "text/plain");
    expect(blob.size).toBe(0);
  });
});
