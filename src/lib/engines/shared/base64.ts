/**
 * Base64 for the `LayoutDocument` JSON hand-off (`pdf-to-word`'s images ride
 * between the `pdfjs` and `docx` engines as base64 strings inside that
 * JSON). Chunked so a multi-megabyte image never blows the argument limit of
 * `String.fromCharCode.apply`. Works in Node and in a worker (`btoa`/`atob`
 * exist in both); no `Uint8Array.prototype.toBase64`, which is too new to
 * rely on.
 */
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
