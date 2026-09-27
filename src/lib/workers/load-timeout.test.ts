import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { EngineId } from "@/lib/registry";
import { loadTimeoutMs } from "./engine-host";

describe("loadTimeoutMs", () => {
  it("never drops below 60 s", () => {
    for (const id of Object.keys(ENGINE_MANIFEST) as EngineId[]) {
      expect(loadTimeoutMs(id)).toBeGreaterThanOrEqual(60_000);
    }
  });

  it("gives large engines time to download on a slow link", () => {
    const largest = (Object.keys(ENGINE_MANIFEST) as EngineId[]).reduce(
      (a, b) =>
        (ENGINE_MANIFEST[a]?.totalBytes ?? 0) >=
        (ENGINE_MANIFEST[b]?.totalBytes ?? 0)
          ? a
          : b,
    );
    const bytes = ENGINE_MANIFEST[largest]?.totalBytes ?? 0;
    // ≥ the time to fetch it at 50 KB/s.
    expect(loadTimeoutMs(largest)).toBeGreaterThanOrEqual(
      (bytes / 50_000) * 1000,
    );
  });
});
