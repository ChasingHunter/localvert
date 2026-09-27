import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineId } from "@/lib/registry";
import {
  classifyLoadFailure,
  isOffline,
  OFFLINE_MESSAGE,
} from "./engine-load-error";

const ENGINE = "canvas" as EngineId;

describe("classifyLoadFailure", () => {
  it("returns the offline message when offline, regardless of cause or timedOut", () => {
    const err = classifyLoadFailure({
      engine: ENGINE,
      cause: new Error("irrelevant"),
      offline: true,
      timedOut: false,
    });
    expect(err.code).toBe("offline");
    expect(err.message).toBe(OFFLINE_MESSAGE);
  });

  it("returns the offline message even when the failure was a timeout, if offline", () => {
    const err = classifyLoadFailure({
      engine: ENGINE,
      offline: true,
      timedOut: true,
    });
    expect(err.code).toBe("offline");
  });

  it("returns a load-timeout error when timed out but not offline", () => {
    const err = classifyLoadFailure({
      engine: ENGINE,
      offline: false,
      timedOut: true,
    });
    expect(err.code).toBe("load-timeout");
    expect(err.message).toContain("canvas");
    expect(err.message).toContain("too long");
  });

  it("returns a generic load-failed error when neither offline nor timed out", () => {
    const cause = new Error("bad response");
    const err = classifyLoadFailure({
      engine: ENGINE,
      cause,
      offline: false,
      timedOut: false,
    });
    expect(err.code).toBe("load-failed");
    expect(err.cause).toBe(cause);
  });
});

describe("isOffline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true when navigator.onLine is false", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOffline()).toBe(true);
  });

  it("is false when navigator.onLine is true", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(isOffline()).toBe(false);
  });

  it("is false when navigator is undefined", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isOffline()).toBe(false);
  });
});
