import { describe, expect, it } from "vitest";
import { probeCapabilities } from "./probes";

/**
 * `probeCapabilities` is typed to take `typeof globalThis`, which a bare
 * fake object is never structurally assignable to (it's missing hundreds of
 * unrelated globals). The whole point of the function is to read off
 * whatever `g` actually has at runtime, so tests cast through `unknown`
 * rather than construct a real global scope.
 */
function fakeGlobal(shape: Record<string, unknown>): typeof globalThis {
  return shape as unknown as typeof globalThis;
}

describe("probeCapabilities", () => {
  it("never throws and defaults everything false/1/null for a bare scope", () => {
    expect(() => probeCapabilities(fakeGlobal({}))).not.toThrow();
    expect(probeCapabilities(fakeGlobal({}))).toEqual({
      crossOriginIsolated: false,
      sharedArrayBuffer: false,
      offscreenCanvas: false,
      webCodecs: {
        videoDecoder: false,
        videoEncoder: false,
        audioDecoder: false,
        audioEncoder: false,
      },
      opfs: false,
      fileSystemAccess: false,
      hardwareConcurrency: 1,
      deviceMemoryGb: null,
    });
  });

  it("reports everything true for a fully capable, isolated scope", () => {
    const g = fakeGlobal({
      crossOriginIsolated: true,
      SharedArrayBuffer: function FakeSharedArrayBuffer() {},
      OffscreenCanvas: function FakeOffscreenCanvas() {},
      VideoDecoder: function FakeVideoDecoder() {},
      VideoEncoder: function FakeVideoEncoder() {},
      AudioDecoder: function FakeAudioDecoder() {},
      AudioEncoder: function FakeAudioEncoder() {},
      showSaveFilePicker: function fakeShowSaveFilePicker() {},
      navigator: {
        hardwareConcurrency: 16,
        deviceMemory: 8,
        storage: { getDirectory: async () => {} },
      },
    });
    expect(probeCapabilities(g)).toEqual({
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      offscreenCanvas: true,
      webCodecs: {
        videoDecoder: true,
        videoEncoder: true,
        audioDecoder: true,
        audioEncoder: true,
      },
      opfs: true,
      fileSystemAccess: true,
      hardwareConcurrency: 16,
      deviceMemoryGb: 8,
    });
  });

  it("reports sharedArrayBuffer false when not cross-origin isolated, even if the constructor exists", () => {
    const g = fakeGlobal({
      crossOriginIsolated: false,
      SharedArrayBuffer: function FakeSharedArrayBuffer() {},
    });
    expect(probeCapabilities(g).sharedArrayBuffer).toBe(false);
  });

  it("never reports fileSystemAccess true from a worker-shaped scope", () => {
    // Workers never have showSaveFilePicker at all; a bare scope already
    // covers "absent", this covers "present but not a function" too.
    const g = fakeGlobal({ showSaveFilePicker: "not-a-function" });
    expect(probeCapabilities(g).fileSystemAccess).toBe(false);
  });

  it.each([
    ["0", 0],
    ["undefined", undefined],
    ["NaN", Number.NaN],
  ])(
    "falls back to 1 hardwareConcurrency core when navigator reports %s",
    (_label, hardwareConcurrency) => {
      const g = fakeGlobal({ navigator: { hardwareConcurrency } });
      expect(probeCapabilities(g).hardwareConcurrency).toBe(1);
    },
  );
});
