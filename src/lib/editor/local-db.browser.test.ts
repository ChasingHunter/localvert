import { beforeEach, describe, expect, it } from "vitest";
import { deleteDraft, loadDraft, saveDraft } from "./draft-store";
import {
  forgetSignature,
  loadSignature,
  saveSignature,
} from "./signature-store";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("localvert");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe("local-db", () => {
  beforeEach(deleteDatabase);

  // Regression: each store used to create only itself on upgrade, so the
  // store opened second at the same version never existed.
  it("keeps drafts working when a signature opened the database first", async () => {
    expect(await saveSignature(new Blob(["sig"], { type: "image/png" }))).toBe(
      true,
    );

    const record = {
      name: "a.pdf",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      savedAt: Date.now(),
    };
    expect(await saveDraft(record)).toBe(true);
    expect((await loadDraft())?.name).toBe("a.pdf");

    await deleteDraft();
    await forgetSignature();
  });

  it("keeps signatures working when a draft opened the database first", async () => {
    const record = {
      name: "b.pdf",
      bytes: new Uint8Array([4]).buffer,
      savedAt: Date.now(),
    };
    expect(await saveDraft(record)).toBe(true);

    expect(await saveSignature(new Blob(["sig"], { type: "image/png" }))).toBe(
      true,
    );
    expect(await loadSignature()).not.toBeNull();

    await deleteDraft();
    await forgetSignature();
  });
});
