/**
 * Drains a byte stream into a single `Blob`. Used for single-file
 * conversions (and anywhere else a whole result needs to become one
 * downloadable object) — batches go through the zip sink instead, since
 * collecting a whole batch into memory first is exactly what streaming to
 * disk exists to avoid. Environment-neutral: no DOM-only globals, so this
 * runs the same inside a worker or on the main thread.
 */
export async function collectToBlob(
  stream: ReadableStream<Uint8Array>,
  type: string,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }
  // Merged into one buffer rather than passed as multiple BlobParts: a
  // chunk read off an arbitrary ReadableStream<Uint8Array> isn't guaranteed
  // to be backed by a plain (non-shared) ArrayBuffer, which is what `Blob`
  // requires — copying once here sidesteps that regardless of the source.
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([merged], { type });
}
