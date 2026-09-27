import { describe, expect, it } from "vitest";
import type { EngineManifestEntry } from "@/lib/engines/meta";
import {
  type ConsentStorage,
  downloadBytes,
  enginesNeedingConsent,
  grantConsent,
  hasConsent,
} from "./consent";

function entry(
  overrides: Partial<EngineManifestEntry> = {},
): EngineManifestEntry {
  return {
    id: "ffmpeg",
    version: "0.12.10",
    license: "GPL-2.0-or-later",
    location: "r2",
    needsIsolation: false,
    heavy: true,
    kind: "job",
    consent: true,
    assets: [
      { path: "ffmpeg-core.js", bytes: 111804 },
      { path: "ffmpeg-core.wasm", bytes: 32232419 },
    ],
    baseUrl: "/engines/xl/ffmpeg@0.12.10/",
    totalBytes: 32344223,
    ...overrides,
  };
}

/** A `ConsentStorage` fake backed by a plain object — no jsdom required. */
function memoryStorage(): ConsentStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

/** A `ConsentStorage` fake that always throws — private/incognito mode. */
function throwingStorage(): ConsentStorage {
  return {
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {
      throw new Error("storage disabled");
    },
  };
}

describe("enginesNeedingConsent", () => {
  const manifest = {
    canvas: entry({ id: "canvas", consent: false }),
    ffmpeg: entry({ id: "ffmpeg", consent: true }),
  };

  it("returns engine ids whose manifest entry has consent: true", () => {
    const tool = {
      pipeline: [
        { op: "transcode", candidates: [{ engine: "ffmpeg" as const }] },
      ],
    };
    expect(enginesNeedingConsent(tool, manifest)).toEqual(["ffmpeg"]);
  });

  it("skips engines whose manifest entry has consent: false", () => {
    const tool = {
      pipeline: [
        { op: "transcode", candidates: [{ engine: "canvas" as const }] },
      ],
    };
    expect(enginesNeedingConsent(tool, manifest)).toEqual([]);
  });

  it("checks every candidate in a step, not just the first", () => {
    const tool = {
      pipeline: [
        {
          op: "transcode",
          candidates: [
            { engine: "canvas" as const },
            { engine: "ffmpeg" as const },
          ],
        },
      ],
    };
    expect(enginesNeedingConsent(tool, manifest)).toEqual(["ffmpeg"]);
  });

  it("de-duplicates an engine id repeated across steps", () => {
    const tool = {
      pipeline: [
        { op: "decode", candidates: [{ engine: "ffmpeg" as const }] },
        { op: "encode", candidates: [{ engine: "ffmpeg" as const }] },
      ],
    };
    expect(enginesNeedingConsent(tool, manifest)).toEqual(["ffmpeg"]);
  });

  it("returns [] for an engine id absent from the manifest", () => {
    const tool = {
      pipeline: [
        { op: "transcode", candidates: [{ engine: "missing" as const }] },
      ],
    };
    expect(enginesNeedingConsent(tool, manifest)).toEqual([]);
  });
});

describe("downloadBytes", () => {
  it("sums every asset's bytes", () => {
    expect(downloadBytes(entry())).toBe(111804 + 32232419);
  });

  it("is 0 for an engine with no assets", () => {
    expect(downloadBytes(entry({ assets: [] }))).toBe(0);
  });
});

describe("hasConsent / grantConsent", () => {
  it("is false before any consent is granted", () => {
    expect(hasConsent(memoryStorage(), "ffmpeg", "0.12.10")).toBe(false);
  });

  it("is true after granting consent for that exact id and version", () => {
    const storage = memoryStorage();
    grantConsent(storage, "ffmpeg", "0.12.10");
    expect(hasConsent(storage, "ffmpeg", "0.12.10")).toBe(true);
  });

  it("does not carry over to a different engine version", () => {
    const storage = memoryStorage();
    grantConsent(storage, "ffmpeg", "0.12.10");
    expect(hasConsent(storage, "ffmpeg", "0.13.0")).toBe(false);
  });

  it("does not carry over to a different engine id", () => {
    const storage = memoryStorage();
    grantConsent(storage, "ffmpeg", "0.12.10");
    expect(hasConsent(storage, "other", "0.12.10")).toBe(false);
  });

  it("hasConsent degrades to false when storage throws", () => {
    expect(hasConsent(throwingStorage(), "ffmpeg", "0.12.10")).toBe(false);
  });

  it("grantConsent swallows a throwing storage instead of rethrowing", () => {
    expect(() =>
      grantConsent(throwingStorage(), "ffmpeg", "0.12.10"),
    ).not.toThrow();
  });
});
