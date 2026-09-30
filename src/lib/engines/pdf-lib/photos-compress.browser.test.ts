import { describe, expect, it } from "vitest";
import type { EngineTask } from "../types";
import adapter from "./adapter";

/**
 * Regression for the 2026-09-30 UX audit (T2): `e2e/fixtures/photos.pdf`
 * (a single 2000x1500 JPEG on a 2000x1500 pt page, i.e. already only 72
 * effective dpi) came back unchanged from the old `balanced` preset. The
 * browser suite fetches the e2e fixture directly (the repo root is Vite's
 * root), so the 1.2 MB file isn't duplicated.
 */
const fixtureUrls = import.meta.glob("../../../../e2e/fixtures/photos.pdf", {
  eager: true,
  query: "?url",
  import: "default",
});
const fixtureUrl = Object.values(fixtureUrls)[0] as string;

function task(
  bytes: ArrayBuffer,
  options: Record<string, unknown>,
): EngineTask {
  return {
    op: "compress",
    input: { kind: "bytes", bytes },
    inputFormat: "pdf",
    outputFormat: "pdf",
    options,
    signal: new AbortController().signal,
  };
}

async function sizeFor(
  bytes: ArrayBuffer,
  options: Record<string, unknown>,
): Promise<number> {
  const instance = await adapter.load({
    baseUrl: "",
    capabilities: {} as never,
  });
  const result = await instance.run(task(bytes, options));
  if (result.kind !== "bytes") throw new Error("expected bytes result");
  return result.bytes.byteLength;
}

describe("compress-pdf on the photos.pdf fixture", () => {
  it("recommended shrinks it below 90% of the input", async () => {
    const bytes = await (await fetch(fixtureUrl)).arrayBuffer();
    const out = await sizeFor(bytes, { mode: "recommended" });
    expect(out).toBeLessThan(bytes.byteLength * 0.9);
  }, 60000);

  it("the legacy 'balanced' value still works and matches recommended", async () => {
    const bytes = await (await fetch(fixtureUrl)).arrayBuffer();
    const legacy = await sizeFor(bytes, { mode: "balanced" });
    const current = await sizeFor(bytes, { mode: "recommended" });
    // The saved PDF embeds a timestamp, so byte counts can differ by a few.
    expect(Math.abs(legacy - current)).toBeLessThan(64);
  }, 60000);

  it("no mode returns a larger file than the input", async () => {
    const bytes = await (await fetch(fixtureUrl)).arrayBuffer();
    for (const mode of ["lossless", "recommended", "strong"]) {
      expect(await sizeFor(bytes, { mode })).toBeLessThanOrEqual(
        bytes.byteLength,
      );
    }
  }, 120000);
});
