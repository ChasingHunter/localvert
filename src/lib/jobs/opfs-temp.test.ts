import { describe, expect, it } from "vitest";
import {
  isStaleOpfsTempFile,
  OPFS_TEMP_DIR,
  OPFS_TEMP_MAX_AGE_MS,
  opfsAvailable,
  opfsTempPath,
} from "./opfs-temp";

describe("opfsTempPath", () => {
  it("names a temp file under the shared directory, by job id and extension", () => {
    expect(opfsTempPath("job-1", "webm")).toBe(`${OPFS_TEMP_DIR}/job-1.webm`);
  });

  it("uses a different extension verbatim", () => {
    expect(opfsTempPath("abc", "mp4")).toBe(`${OPFS_TEMP_DIR}/abc.mp4`);
  });
});

describe("isStaleOpfsTempFile", () => {
  it("is not stale exactly at the age threshold", () => {
    const now = 1_000_000;
    expect(isStaleOpfsTempFile(now - OPFS_TEMP_MAX_AGE_MS, now)).toBe(false);
  });

  it("is stale one ms past the threshold", () => {
    const now = 1_000_000;
    expect(isStaleOpfsTempFile(now - OPFS_TEMP_MAX_AGE_MS - 1, now)).toBe(true);
  });

  it("is not stale for a file modified moments ago", () => {
    const now = 1_000_000;
    expect(isStaleOpfsTempFile(now - 1000, now)).toBe(false);
  });

  it("is not stale for a file modified in the future (clock skew)", () => {
    const now = 1_000_000;
    expect(isStaleOpfsTempFile(now + 1000, now)).toBe(false);
  });
});

describe("opfsAvailable", () => {
  it("reflects whether navigator.storage.getDirectory exists", () => {
    // In this (non-browser) Vitest environment there is no real `navigator`
    // OPFS support, so this documents the negative case; the positive case
    // is exercised by the mediabunny adapter's browser test.
    expect(opfsAvailable()).toBe(false);
  });
});
