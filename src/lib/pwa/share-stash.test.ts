import { describe, expect, it } from "vitest";
import {
  filesFromForm,
  SHARE_CACHE,
  stashSharedFiles,
  takeSharedFiles,
} from "./share-stash";

/** Just enough of Cache Storage for the stash: put, keys, match, delete. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const cacheFor = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      async put(key: string, response: Response) {
        store.set(key, response);
      },
      async keys() {
        return [...store.keys()].map((url) => new Request(url));
      },
      async match(request: Request) {
        return store.get(request.url)?.clone();
      },
    };
  };
  const caches = {
    async open(name: string) {
      return cacheFor(name);
    },
    async has(name: string) {
      return stores.has(name);
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  return { caches: caches as unknown as CacheStorage, stores };
}

describe("share stash", () => {
  const ORIGIN = "https://example.test";

  it("round-trips names, types and bytes in order, then empties itself", async () => {
    const { caches, stores } = fakeCaches();
    await stashSharedFiles(caches, ORIGIN, [
      new File(["one"], "my song (1).mp3", { type: "audio/mpeg" }),
      new File(["two!"], "naïve é.pdf", { type: "application/pdf" }),
    ]);
    expect(stores.has(SHARE_CACHE)).toBe(true);

    const files = await takeSharedFiles(caches);
    expect(files.map((f) => f.name)).toEqual([
      "my song (1).mp3",
      "naïve é.pdf",
    ]);
    expect(files.map((f) => f.type)).toEqual(["audio/mpeg", "application/pdf"]);
    expect(await files[1]?.text()).toBe("two!");
    expect(stores.has(SHARE_CACHE)).toBe(false);
  });

  it("keeps a file with no type typeless", async () => {
    const { caches } = fakeCaches();
    await stashSharedFiles(caches, ORIGIN, [new File(["x"], "mystery.bin")]);
    const [file] = await takeSharedFiles(caches);
    expect(file?.type).toBe("");
  });

  it("replaces leftovers from an earlier share", async () => {
    const { caches } = fakeCaches();
    await stashSharedFiles(caches, ORIGIN, [new File(["a"], "old.txt")]);
    await stashSharedFiles(caches, ORIGIN, [new File(["b"], "new.txt")]);
    const files = await takeSharedFiles(caches);
    expect(files.map((f) => f.name)).toEqual(["new.txt"]);
  });

  it("returns nothing when nothing is stashed", async () => {
    const { caches } = fakeCaches();
    expect(await takeSharedFiles(caches)).toEqual([]);
  });
});

describe("filesFromForm", () => {
  it("keeps only File entries under the files field", () => {
    const form = new FormData();
    form.append("files", new File(["a"], "a.txt"));
    form.append("files", "not a file");
    form.append("title", "ignored");
    expect(filesFromForm(form).map((f) => f.name)).toEqual(["a.txt"]);
  });
});
