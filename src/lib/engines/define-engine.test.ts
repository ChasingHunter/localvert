import { describe, expect, it } from "vitest";
import { defineEngine } from "./define-engine";
import type { EngineAdapter } from "./types";

function validAdapter(overrides: Partial<EngineAdapter> = {}): EngineAdapter {
  return {
    id: "canvas",
    version: "1.0.0",
    license: "MIT",
    marker: "localvert-engine:canvas",
    location: "static",
    needsIsolation: false,
    heavy: false,
    supports: () => true,
    load: async () => ({
      run: async () => {
        throw new Error("not implemented");
      },
      dispose: () => {},
    }),
    ...overrides,
  };
}

describe("defineEngine", () => {
  it("returns the same object for a valid adapter", () => {
    const adapter = validAdapter();
    expect(defineEngine(adapter)).toBe(adapter);
  });

  it("rejects a marker that does not match the adapter id", () => {
    const adapter = validAdapter({
      marker: "localvert-engine:wrong" as EngineAdapter["marker"],
    });
    expect(() => defineEngine(adapter)).toThrow(/^\[engine canvas\]/);
  });

  it("rejects a version that is not semver", () => {
    const adapter = validAdapter({ version: "v1" });
    expect(() => defineEngine(adapter)).toThrow(/^\[engine canvas\]/);
  });

  it("accepts a semver version with a pre-release or build tag", () => {
    expect(() =>
      defineEngine(validAdapter({ version: "1.0.0-beta.1" })),
    ).not.toThrow();
    expect(() =>
      defineEngine(validAdapter({ version: "1.0.0+build.7" })),
    ).not.toThrow();
  });

  it("rejects an empty license", () => {
    const adapter = validAdapter({ license: "  " });
    expect(() => defineEngine(adapter)).toThrow(/^\[engine canvas\]/);
  });

  it("allows location native with needsIsolation true", () => {
    const adapter = validAdapter({
      location: "native",
      needsIsolation: true,
    });
    expect(() => defineEngine(adapter)).not.toThrow();
  });
});
