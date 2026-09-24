import {
  type FormatId,
  formatFromFilename,
  sniffFile,
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

/**
 * Sorts dropped/picked/pasted files into accepted and rejected buckets by
 * their **content**, not their name — `sniffFile` reads magic bytes, never
 * trusts the extension. Pure aside from the injected `sniff`, so it is
 * node-testable with fake `File`s and swappable in `Dropzone` for a stub.
 */
export async function classifyFiles(
  files: readonly File[],
  accepts: readonly FormatId[],
  sniff: (file: Blob) => Promise<FormatId | null> = sniffFile,
): Promise<ClassifyResult> {
  const accepted: AcceptedFile[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    const detected = await sniff(file);
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
