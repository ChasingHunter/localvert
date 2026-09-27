import {
  type FormatId,
  formatFromFilename,
  looksLikeText,
  refineFormat,
  sniffFile,
  TEXT_SNIFF_BYTES,
  textFormatFromExtension,
} from "@/lib/registry/formats";

export interface AcceptedFile {
  file: File;
  format: FormatId;
  /** The file's extension names a different format than its bytes do. */
  extensionMismatch: boolean;
}

export interface RejectedFile {
  file: File;
  reason: "unknown-format" | "not-accepted";
  /** The format its bytes sniffed to, or `null` for "unknown-format". */
  detected: FormatId | null;
}

export interface ClassifyResult {
  accepted: AcceptedFile[];
  rejected: RejectedFile[];
}

/** Reads a file's first `TEXT_SNIFF_BYTES` bytes, for the text-format fallback below. */
async function defaultReadTextHead(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, TEXT_SNIFF_BYTES).arrayBuffer());
}

/**
 * Sorts dropped/picked/pasted files into accepted and rejected buckets by
 * their **content**, not their name — `sniffFile` reads magic bytes, never
 * trusts the extension. Pure aside from the injected `sniff`/`readTextHead`,
 * so it is node-testable with fake `File`s and swappable in `Dropzone` for a
 * stub.
 */
export async function classifyFiles(
  files: readonly File[],
  accepts: readonly FormatId[],
  sniff: (file: Blob) => Promise<FormatId | null> = sniffFile,
  readTextHead: (file: Blob) => Promise<Uint8Array> = defaultReadTextHead,
): Promise<ClassifyResult> {
  const accepted: AcceptedFile[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    // `refineFormat` upgrades a "tiff" sniff to "raw" by extension — CR2,
    // NEF, ARW, DNG and the rest are themselves valid TIFF files, so bytes
    // alone can't tell a camera raw from a plain scan (see its doc comment
    // in `formats.ts`). Every other sniffed format passes through unchanged.
    let detected = refineFormat(await sniff(file), file.name);

    // Magic bytes always win — this fallback only runs once the magic
    // sniff has already come back empty-handed. A csv/json/yaml file has no
    // signature of its own to sniff (see `FormatSpec.text`'s doc comment),
    // so the extension gets one more chance, gated on the file actually
    // looking like text rather than binary junk wearing a text extension.
    if (detected === null) {
      const textFormat = textFormatFromExtension(file.name);
      if (textFormat !== null && looksLikeText(await readTextHead(file))) {
        detected = textFormat;
      }
    }

    if (detected === null) {
      rejected.push({ file, reason: "unknown-format", detected: null });
      continue;
    }
    if (!accepts.includes(detected)) {
      rejected.push({ file, reason: "not-accepted", detected });
      continue;
    }
    accepted.push({
      file,
      format: detected,
      extensionMismatch: formatFromFilename(file.name) !== detected,
    });
  }

  return { accepted, rejected };
}
