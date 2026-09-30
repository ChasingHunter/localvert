import { describe, expect, it } from "vitest";
import { grantEngineConsent, pendingConsentPrompt } from "./consent-gate";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const ffmpegTool = {
  pipeline: [{ candidates: [{ engine: "ffmpeg" }] }],
} as never;
const canvasTool = {
  pipeline: [{ candidates: [{ engine: "canvas" }] }],
} as never;

describe("pendingConsentPrompt", () => {
  it("asks for a consent-gated engine, with license, size and source link", () => {
    const prompt = pendingConsentPrompt(ffmpegTool, memoryStorage());
    expect(prompt?.engineId).toBe("ffmpeg");
    expect(prompt?.bytes).toBeGreaterThan(0);
    expect(prompt?.sourceUrl).toMatch(/^https:/);
  });

  it("does not ask again once consent is granted", () => {
    const storage = memoryStorage();
    grantEngineConsent(storage, "ffmpeg");
    expect(pendingConsentPrompt(ffmpegTool, storage)).toBeNull();
  });

  it("never asks for an engine that needs no consent", () => {
    expect(pendingConsentPrompt(canvasTool, memoryStorage())).toBeNull();
  });
});
