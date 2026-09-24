import { describe, expect, it } from "vitest";
import { EngineError, isEngineError, toEngineError } from "./errors";

describe("EngineError", () => {
  it("carries code, message, engine and name", () => {
    const err = new EngineError("decode-failed", "bad frame", {
      engine: "canvas",
    });
    expect(err.name).toBe("EngineError");
    expect(err.code).toBe("decode-failed");
    expect(err.message).toBe("bad frame");
    expect(err.engine).toBe("canvas");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("isEngineError", () => {
  it("accepts a real EngineError instance", () => {
    expect(isEngineError(new EngineError("internal", "x"))).toBe(true);
  });

  it("accepts a plain object shaped like an EngineError", () => {
    // A worker boundary (postMessage / a Comlink RPC) can hand back data
    // that was never `instanceof EngineError` on this side — either because
    // it round-tripped through structured clone, or because the sender built
    // it as plain data on purpose. Either way it must still be recognized.
    expect(isEngineError({ name: "EngineError", code: "aborted" })).toBe(true);
  });

  it("rejects a plain Error", () => {
    expect(isEngineError(new Error("nope"))).toBe(false);
  });

  it("rejects null, undefined and non-EngineError-shaped objects", () => {
    expect(isEngineError(null)).toBe(false);
    expect(isEngineError(undefined)).toBe(false);
    expect(isEngineError({ name: "EngineError" })).toBe(false); // no code
    expect(isEngineError({ code: "aborted" })).toBe(false); // no name
  });

  it("does not falsely accept Node's structuredClone of an EngineError", () => {
    // Empirically (Node 22, V8's structured clone algorithm): cloning an
    // Error *subclass* does not preserve the subclass or any custom own
    // property. `name` is reset to the generic "Error", and `code`/`engine`
    // are dropped entirely — only `message`, `stack` and `cause` survive.
    // So a raw structuredClone of an EngineError is indistinguishable from a
    // plain Error, and isEngineError correctly says no. This is exactly why
    // isEngineError also accepts the plain `{name, code}` shape above: a
    // worker RPC layer that wants `code` to survive the boundary has to
    // serialize it as data on purpose, not rely on structured clone alone.
    const clone = structuredClone(new EngineError("aborted", "msg"));
    expect(clone.name).toBe("Error");
    expect(isEngineError(clone)).toBe(false);
  });
});

describe("toEngineError", () => {
  it("passes an existing EngineError through unchanged", () => {
    const err = new EngineError("unsupported", "no codec", {
      engine: "canvas",
    });
    expect(toEngineError(err)).toBe(err);
  });

  it("maps an AbortError DOMException to code aborted", () => {
    const aborted = new DOMException("stopped", "AbortError");
    const err = toEngineError(aborted, "canvas");
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("aborted");
    expect(err.engine).toBe("canvas");
    expect(err.cause).toBe(aborted);
  });

  it("maps a RangeError mentioning memory to out-of-memory", () => {
    const err = toEngineError(new RangeError("out of memory allocating heap"));
    expect(err.code).toBe("out-of-memory");
  });

  it("maps a RangeError mentioning allocation to out-of-memory", () => {
    const err = toEngineError(new RangeError("allocation size overflow"));
    expect(err.code).toBe("out-of-memory");
  });

  it("maps an unrelated RangeError to internal", () => {
    const err = toEngineError(new RangeError("index out of bounds"));
    expect(err.code).toBe("internal");
  });

  it("maps any other thrown value to internal, keeping it as the cause", () => {
    const original = new TypeError("boom");
    const err = toEngineError(original, "canvas");
    expect(err.code).toBe("internal");
    expect(err.message).toBe("boom");
    expect(err.cause).toBe(original);
    expect(err.engine).toBe("canvas");
  });

  it("stringifies a non-Error thrown value", () => {
    const err = toEngineError("just a string");
    expect(err.code).toBe("internal");
    expect(err.message).toBe("just a string");
  });
});
