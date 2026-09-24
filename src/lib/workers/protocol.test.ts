import { describe, expect, it } from "vitest";
import { EngineError } from "@/lib/engines";
import { deserializeEngineError, serializeEngineError } from "./protocol";

describe("serializeEngineError / deserializeEngineError", () => {
  it("round-trips code, message and engine through structuredClone", () => {
    // The whole point of this pair: a raw structuredClone of an EngineError
    // drops `code` (see errors.test.ts), but a structuredClone of the plain
    // object serializeEngineError produces does not — `code` is just a
    // string field on ordinary data at that point.
    const original = new EngineError("decode-failed", "bad frame", {
      engine: "canvas",
    });
    const cloned = structuredClone(serializeEngineError(original));
    expect(cloned.code).toBe("decode-failed");

    const restored = deserializeEngineError(cloned);
    expect(restored).toBeInstanceOf(EngineError);
    expect(restored.name).toBe("EngineError");
    expect(restored.code).toBe("decode-failed");
    expect(restored.message).toBe("bad frame");
    expect(restored.engine).toBe("canvas");
  });

  it("round-trips an error with no engine", () => {
    const original = new EngineError("aborted", "cancelled");
    const cloned = structuredClone(serializeEngineError(original));
    expect(cloned.engine).toBeUndefined();

    const restored = deserializeEngineError(cloned);
    expect(restored.code).toBe("aborted");
    expect(restored.engine).toBeUndefined();
  });

  it("round-trips every EngineErrorCode", () => {
    const codes = [
      "unsupported",
      "aborted",
      "load-failed",
      "decode-failed",
      "encode-failed",
      "out-of-memory",
      "internal",
    ] as const;
    for (const code of codes) {
      const cloned = structuredClone(
        serializeEngineError(new EngineError(code, code)),
      );
      expect(deserializeEngineError(cloned).code).toBe(code);
    }
  });
});
