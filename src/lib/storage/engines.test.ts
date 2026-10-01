import { describe, expect, it } from "vitest";
import {
  clearEngineConsent,
  groupEngineEntries,
  type KeyedStorage,
  parseEngineUrl,
} from "./engines";

const manifest = {
  typst: { version: "0.7.0" },
  ffmpeg: { version: "0.12.10" },
  "jsquash-png": { version: "3.1.1" },
};
const name = (id: string) => id.toUpperCase();

describe("parseEngineUrl", () => {
  it("reads static and xl paths, ids with hyphens included", () => {
    expect(
      parseEngineUrl("https://x.test/engines/typst--0.7.0/a.wasm"),
    ).toEqual({ id: "typst", version: "0.7.0" });
    expect(parseEngineUrl("/engines/xl/ffmpeg--0.12.10/core.wasm")).toEqual({
      id: "ffmpeg",
      version: "0.12.10",
    });
    expect(parseEngineUrl("/engines/jsquash-png--3.1.1/x.wasm")).toEqual({
      id: "jsquash-png",
      version: "3.1.1",
    });
  });
  it("ignores anything else", () => {
    expect(parseEngineUrl("/engines/readme.txt")).toBeNull();
    expect(parseEngineUrl("/other/typst--0.7.0/a")).toBeNull();
  });
});

describe("groupEngineEntries", () => {
  it("sums entries per engine version, biggest first", () => {
    const rows = groupEngineEntries(
      [
        { url: "/engines/typst--0.7.0/a.wasm", bytes: 100 },
        { url: "/engines/typst--0.7.0/b.js", bytes: 20 },
        { url: "/engines/xl/ffmpeg--0.12.10/c.wasm", bytes: 5000 },
      ],
      manifest,
      name,
    );
    expect(rows.map((r) => [r.id, r.bytes, r.old])).toEqual([
      ["ffmpeg", 5000, false],
      ["typst", 120, false],
    ]);
    expect(rows[1]?.urls).toHaveLength(2);
    expect(rows[1]?.name).toBe("TYPST");
  });
  it("flags a version the manifest has moved past, keeping both rows", () => {
    const rows = groupEngineEntries(
      [
        { url: "/engines/typst--0.6.0/a.wasm", bytes: 10 },
        { url: "/engines/typst--0.7.0/a.wasm", bytes: 20 },
      ],
      manifest,
      name,
    );
    expect(rows.find((r) => r.version === "0.6.0")?.old).toBe(true);
    expect(rows.find((r) => r.version === "0.7.0")?.old).toBe(false);
  });
  it("keeps an unknown id, not flagged old", () => {
    const rows = groupEngineEntries(
      [{ url: "/engines/gone--1.0.0/a", bytes: 1 }],
      manifest,
      name,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "gone", name: "GONE", old: false });
  });
});

function fakeStorage(initial: Record<string, string>): KeyedStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe("clearEngineConsent", () => {
  const seed = {
    "localvert:engine-consent:ffmpeg@0.12.10": "granted",
    "localvert:engine-consent:ffmpeg@0.12.9": "granted",
    "localvert:engine-consent:libreoffice@2.3.1": "granted",
    theme: "dark",
  };
  it("clears every version of one engine only", () => {
    const s = fakeStorage(seed);
    clearEngineConsent(s, "ffmpeg");
    expect([...s.data.keys()].sort()).toEqual([
      "localvert:engine-consent:libreoffice@2.3.1",
      "theme",
    ]);
  });
  it("clears all engines but leaves other keys", () => {
    const s = fakeStorage(seed);
    clearEngineConsent(s);
    expect([...s.data.keys()]).toEqual(["theme"]);
  });
  it("does not throw when storage does", () => {
    const bad: KeyedStorage = {
      get length(): number {
        throw new Error("blocked");
      },
      key: () => null,
      removeItem: () => {},
    };
    expect(() => clearEngineConsent(bad, "ffmpeg")).not.toThrow();
  });
});
