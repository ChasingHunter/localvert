import { describe, expect, it, vi } from "vitest";

/**
 * `imagePipeline` filters its preference tables against `ENGINE_MANIFEST` at
 * call time, so these tests mock that module per case to exercise both a
 * "some engines built yet" manifest and a "none of them yet" one — the
 * `vi.resetModules()` + dynamic `import` dance is what lets each `it` load a
 * fresh `imagePipeline` bound to its own mocked manifest, rather than the one
 * `vi.mock` static-hoists for the whole file.
 */
async function loadWithManifest(manifest: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("@/lib/engines/manifest", () => ({ ENGINE_MANIFEST: manifest }));
  const mod = await import("./image-pipeline");
  return mod.imagePipeline;
}

describe("imagePipeline", () => {
  it("filters candidates to known engines, preserving preference order", async () => {
    const imagePipeline = await loadWithManifest({
      canvas: {},
      "jsquash-jpeg": {},
    });
    const steps = imagePipeline("jpg", "png");

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ op: "decode", from: "jpg", to: "raster" });
    // jpg's decode preference is [jsquash-jpeg, canvas] — both known here,
    // in that order.
    expect(steps[0]?.candidates).toEqual([
      { engine: "jsquash-jpeg" },
      { engine: "canvas" },
    ]);

    expect(steps[1]).toMatchObject({ op: "encode", from: "raster", to: "png" });
    // png's encode preference is [jsquash-png, canvas] — only canvas is
    // known here, so jsquash-png is silently dropped.
    expect(steps[1]?.candidates).toEqual([{ engine: "canvas" }]);
  });

  it("defaults to no transform steps", async () => {
    const imagePipeline = await loadWithManifest({ canvas: {} });
    const steps = imagePipeline("jpg", "png");
    expect(steps.map((s) => s.op)).toEqual(["decode", "encode"]);
  });

  it("inserts one raster -> raster step per transform, in order, between decode and encode", async () => {
    const imagePipeline = await loadWithManifest({ canvas: {} });
    const steps = imagePipeline("jpg", "jpg", ["rotate", "crop"]);

    expect(steps.map((s) => s.op)).toEqual([
      "decode",
      "rotate",
      "crop",
      "encode",
    ]);
    expect(steps[1]).toMatchObject({ from: "raster", to: "raster" });
    expect(steps[2]).toMatchObject({ from: "raster", to: "raster" });
  });

  it("every candidate is unconditional — no `when` guard", async () => {
    const imagePipeline = await loadWithManifest({ canvas: {} });
    const steps = imagePipeline("jpg", "png", ["resize", "rotate", "crop"]);
    for (const step of steps) {
      for (const candidate of step.candidates) {
        expect(candidate.when).toBeUndefined();
      }
    }
  });

  it("throws at call time when no known engine can decode the source format", async () => {
    const imagePipeline = await loadWithManifest({ canvas: {} });
    // avif's only decode candidate is jsquash-avif, not in this manifest.
    expect(() => imagePipeline("avif", "jpg")).toThrow(
      "[imagePipeline] no engine can decode avif",
    );
  });

  it("throws at call time when no known engine can encode the target format", async () => {
    const imagePipeline = await loadWithManifest({ canvas: {} });
    // avif's only encode candidate is jsquash-avif, not in this manifest.
    expect(() => imagePipeline("jpg", "avif")).toThrow(
      "[imagePipeline] no engine can encode avif",
    );
  });

  it("throws at call time when no known engine can run a requested transform", async () => {
    // canvas covers every transform, so it has to be absent too — jpg/png
    // still decode/encode fine through the jsquash pair.
    const imagePipeline = await loadWithManifest({
      "jsquash-jpeg": {},
      "jsquash-png": {},
    });
    expect(() => imagePipeline("jpg", "png", ["resize"])).toThrow(
      "[imagePipeline] no engine can resize an image",
    );
  });
});
