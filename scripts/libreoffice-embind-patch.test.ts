import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { patchLibreOfficeEmbind } from "./sync-engines";

/**
 * `patchLibreOfficeEmbind`'s job is described in full in `sync-engines.ts`'s
 * doc comment above it (ADR-0012): `@bentopdf/libreoffice-wasm`'s
 * `assets/soffice.js` embeds two runtime code-generation sites
 * (`craftInvokerFunction` and `__emval_get_method_caller`), both routed
 * through `newFunc(Function, args)` — effectively `new Function(...)` —
 * which CSP's `script-src` (no `unsafe-eval`) blocks outright. These tests
 * exercise the patch against the real installed package (so a
 * `libreoffice-wasm` upgrade that reshapes either function fails this suite,
 * not silently in the browser), and, separately, load the patched functions
 * in isolation with fake wire types to prove the eval-free replacements
 * reproduce the generated bodies' behaviour: arg wiring, `this` wiring,
 * destructors, return conversion, and the arg-count error.
 */

function readRealSoffice(): string {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve(
    "@bentopdf/libreoffice-wasm/package.json",
  );
  const pkgDir = dirname(pkgJsonPath);
  return readFileSync(join(pkgDir, "assets", "soffice.js"), "utf8");
}

describe("patchLibreOfficeEmbind", () => {
  it("the real installed package's glue patches cleanly with zero remaining newFunc(Function/new Function(", () => {
    const real = readRealSoffice();
    const patched = patchLibreOfficeEmbind(real);

    expect(patched).not.toContain("newFunc(Function");
    expect(patched).not.toContain("new Function(");
    expect(patched).toContain("function invokerFunction(...callArgs)");
    expect(patched).toContain(
      "function invokerFunction(obj,func,destructorsRef,args)",
    );
  });

  it("throws if craftInvokerFunction is missing (fails the build loudly)", () => {
    const real = readRealSoffice();
    const withoutCraft = real.replace(
      "function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){",
      "function craftInvokerFunctionRenamed(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){",
    );
    expect(() => patchLibreOfficeEmbind(withoutCraft)).toThrow(
      /expected exactly one craftInvokerFunction, found 0/,
    );
  });

  it("throws if the emval method caller is missing", () => {
    const real = readRealSoffice();
    const withoutMethodCaller = real.replace(
      "function __emval_get_method_caller(argCount,argTypes,kind){",
      "function __emval_get_method_caller_renamed(argCount,argTypes,kind){",
    );
    expect(() => patchLibreOfficeEmbind(withoutMethodCaller)).toThrow(
      /expected exactly one __emval_get_method_caller, found 0/,
    );
  });

  it("throws if a targeted function appears twice (ambiguous match)", () => {
    const real = readRealSoffice();
    const duplicated = real + real;
    expect(() => patchLibreOfficeEmbind(duplicated)).toThrow(
      /expected exactly one craftInvokerFunction, found 2/,
    );
  });
});

// ---------------------------------------------------------------------------
// Behavioural tests: load the patched functions in isolation (via a data:
// URL — no bare `eval`/`new Function` of untrusted content here either, just
// proving the *patched output* behaves correctly at runtime) with fake wire
// types standing in for embind's real ones, and drive them directly.
// ---------------------------------------------------------------------------

/** Extracts one function's exact literal source out of the real installed
 * `soffice.js`, using the same start/end anchors `sync-engines.ts` matches
 * on, so these fixtures can never silently drift from what the patch
 * actually targets. */
function extractFunction(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const endIdx = source.indexOf(endMarker, start);
  if (endIdx === -1) throw new Error(`end marker not found: ${endMarker}`);
  return source.slice(start, endIdx + endMarker.length);
}

/** Loads a small module exposing `craftInvokerFunction` plus the handful of
 * embind helpers it closes over — all faked, just enough to exercise the
 * patched invoker's own logic (arg count check, wiring, destructors, return
 * conversion) in isolation. */
async function loadPatchedCraftInvoker(): Promise<{
  craftInvokerFunction: (
    humanName: string,
    argTypes: unknown[],
    classType: unknown,
    cppInvokerFunc: (...args: unknown[]) => unknown,
    cppTargetFunc: unknown,
    isAsync: boolean,
  ) => (...args: unknown[]) => unknown;
  calls: { destructors: unknown[][] };
}> {
  const real = readRealSoffice();
  const patchedFn = extractFunction(
    patchLibreOfficeEmbind(real),
    "function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){",
    "return createNamedFunction(humanName,invokerFunction)\n}",
  );

  const module = `
    const calls = { destructors: [] };
    function throwBindingError(message) { throw new Error(message); }
    function assert(cond, message) { if (!cond) throw new Error(message); }
    function usesDestructorStack(argTypes) {
      for (let i = 1; i < argTypes.length; ++i) {
        if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) return true;
      }
      return false;
    }
    function getRequiredArgCount(argTypes) {
      let requiredArgCount = argTypes.length - 2;
      for (let i = argTypes.length - 1; i >= 2; --i) {
        if (!argTypes[i].optional) break;
        requiredArgCount--;
      }
      return requiredArgCount;
    }
    function checkArgCount(numArgs, minArgs, maxArgs, humanName, throwBindingError) {
      if (numArgs < minArgs || numArgs > maxArgs) {
        throwBindingError(\`function \${humanName} called with \${numArgs} arguments, expected \${minArgs === maxArgs ? minArgs : \`\${minArgs} to \${maxArgs}\`}\`);
      }
    }
    function createNamedFunction(name, body) { return Object.defineProperty(body, "name", { value: name }); }
    function runDestructors(destructors) {
      calls.destructors.push(destructors.slice());
      while (destructors.length) {
        const ptr = destructors.pop();
        const del = destructors.pop();
        del(ptr);
      }
    }
    ${patchedFn}
    export { craftInvokerFunction, calls };
  `;
  const url = `data:text/javascript;base64,${Buffer.from(module).toString("base64")}`;
  const mod = (await import(url)) as {
    craftInvokerFunction: (
      humanName: string,
      argTypes: unknown[],
      classType: unknown,
      cppInvokerFunc: (...args: unknown[]) => unknown,
      cppTargetFunc: unknown,
      isAsync: boolean,
    ) => (...args: unknown[]) => unknown;
    calls: { destructors: unknown[][] };
  };
  return mod;
}

/** A fake embind "type" — just enough of the real contract
 * (`toWireType`/`fromWireType`/`destructorFunction`/`name`) for the invoker's
 * own logic to exercise. */
function fakeType(opts: {
  name: string;
  toWireType?: (destructors: unknown[] | null, value: unknown) => unknown;
  fromWireType?: (wire: unknown) => unknown;
  destructorFunction?: ((ptr: unknown) => void) | null;
}) {
  return {
    name: opts.name,
    toWireType: opts.toWireType ?? ((_d: unknown, v: unknown) => v),
    fromWireType: opts.fromWireType ?? ((w: unknown) => w),
    destructorFunction: opts.destructorFunction ?? null,
  };
}

describe("patched craftInvokerFunction (behavioural)", () => {
  it("wires arguments, invokes the C++ trampoline, and converts the return value", async () => {
    const { craftInvokerFunction } = await loadPatchedCraftInvoker();
    const retType = fakeType({
      name: "int",
      fromWireType: (w) => (w as number) * 2,
    });
    const argType0 = fakeType({
      name: "int",
      toWireType: (_d, v) => (v as number) + 1,
    });
    const cppInvokerFunc = (fn: unknown, argWired: unknown) => {
      expect(fn).toBe("cppTargetFunc");
      return (argWired as number) + 100;
    };

    const invoker = craftInvokerFunction(
      "TestClass.method",
      [retType, null, argType0],
      null,
      cppInvokerFunc,
      "cppTargetFunc",
      false,
    );

    // arg 5 -> toWireType -> 6 -> cppInvokerFunc adds 100 -> 106 -> fromWireType doubles -> 212
    expect(invoker(5)).toBe(212);
  });

  it("wires `this` through classParam.toWireType for a class method", async () => {
    const { craftInvokerFunction } = await loadPatchedCraftInvoker();
    const retType = fakeType({ name: "void" });
    const classParam = fakeType({
      name: "TestClass",
      toWireType: (_d, v) => `wired(${v})`,
    });
    let seenThisWired: unknown;
    const cppInvokerFunc = (_fn: unknown, thisWired: unknown) => {
      seenThisWired = thisWired;
      return 0;
    };

    const invoker = craftInvokerFunction(
      "TestClass.method",
      [retType, classParam],
      { name: "TestClass" },
      cppInvokerFunc,
      "cppTargetFunc",
      false,
    );

    invoker.call("the-instance");
    expect(seenThisWired).toBe("wired(the-instance)");
  });

  it("runs destructors via the shared stack when any arg needs one", async () => {
    const { craftInvokerFunction, calls } = await loadPatchedCraftInvoker();
    const retType = fakeType({ name: "void" });
    const destroyed: unknown[] = [];
    // Built directly rather than via `fakeType` (which defaults a missing
    // `destructorFunction` to `null`): omitting it entirely is what makes
    // `usesDestructorStack` return true, exercising the shared-stack path.
    const argType0 = {
      name: "std::string",
      toWireType: (destructors: unknown[] | null, v: unknown) => {
        (destructors as unknown[]).push(
          (ptr: unknown) => destroyed.push(ptr),
          "wired-ptr",
        );
        return `wired(${v})`;
      },
      fromWireType: (w: unknown) => w,
    };
    const cppInvokerFunc = () => 0;

    const invoker = craftInvokerFunction(
      "TestClass.method",
      [retType, null, argType0],
      null,
      cppInvokerFunc,
      "cppTargetFunc",
      false,
    );

    invoker("hello");
    expect(destroyed).toEqual(["wired-ptr"]);
    expect(calls.destructors.length).toBe(1);
  });

  it("runs each argument's own destructorFunction when no destructor stack is needed", async () => {
    const { craftInvokerFunction } = await loadPatchedCraftInvoker();
    const retType = fakeType({ name: "void" });
    const destroyed: unknown[] = [];
    const argType0 = fakeType({
      name: "int",
      toWireType: (_d, v) => (v as number) + 1,
      destructorFunction: (ptr: unknown) => destroyed.push(ptr),
    });
    const cppInvokerFunc = () => 0;

    const invoker = craftInvokerFunction(
      "TestClass.method",
      [retType, null, argType0],
      null,
      cppInvokerFunc,
      "cppTargetFunc",
      false,
    );

    invoker(41);
    expect(destroyed).toEqual([42]);
  });

  it("throws the expected error when called with the wrong argument count", async () => {
    const { craftInvokerFunction } = await loadPatchedCraftInvoker();
    const retType = fakeType({ name: "void" });
    const argType0 = fakeType({ name: "int" });
    const invoker = craftInvokerFunction(
      "TestClass.method",
      [retType, null, argType0],
      null,
      () => 0,
      "cppTargetFunc",
      false,
    );

    expect(() => invoker()).toThrow(
      /TestClass\.method called with 0 arguments, expected 1/,
    );
  });
});

/** Loads the patched `__emval_get_method_caller` plus the handful of emval
 * helpers it closes over, all faked. */
async function loadPatchedMethodCaller(): Promise<{
  getMethodCaller: (
    types: unknown[],
    kind: number,
  ) => (
    obj: unknown,
    func: (...args: unknown[]) => unknown,
    destructorsRef: unknown,
    args: number,
  ) => unknown;
}> {
  const real = readRealSoffice();
  const patchedFn = extractFunction(
    patchLibreOfficeEmbind(real),
    "function __emval_get_method_caller(argCount,argTypes,kind){",
    "return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))\n}",
  );

  const module = `
    let lookupTable = [];
    function emval_lookupTypes(argCount, argTypesAddr) {
      return lookupTable.slice(0, argCount);
    }
    const returnValueCalls = [];
    function emval_returnValue(retType, destructorsRef, rv) {
      returnValueCalls.push({ retType, destructorsRef, rv });
      return retType.fromWireType(rv);
    }
    const callers = [];
    function emval_addMethodCaller(caller) {
      callers.push(caller);
      return callers.length - 1;
    }
    function createNamedFunction(name, body) { return Object.defineProperty(body, "name", { value: name }); }
    ${patchedFn}
    function getMethodCaller(types, kind) {
      lookupTable = types;
      const id = __emval_get_method_caller(types.length, 0, kind);
      return callers[id];
    }
    export { getMethodCaller };
  `;
  const url = `data:text/javascript;base64,${Buffer.from(module).toString("base64")}`;
  const mod = (await import(url)) as {
    getMethodCaller: (
      types: unknown[],
      kind: number,
    ) => (
      obj: unknown,
      func: (...args: unknown[]) => unknown,
      destructorsRef: unknown,
      args: number,
    ) => unknown;
  };
  return mod;
}

/** A fake emval argument type: reads a fixed value off the (fake) pointer
 * packet and advances by a fixed pack size, like the real `argPackAdvance`
 * contract. */
function fakeEmvalType(opts: {
  name: string;
  value: unknown;
  argPackAdvance?: number;
  isVoid?: boolean;
}) {
  return {
    name: opts.name,
    isVoid: opts.isVoid ?? false,
    argPackAdvance: opts.argPackAdvance ?? 8,
    readValueFromPointer: (_ptr: number) => opts.value,
    fromWireType: (w: unknown) => w,
  };
}

describe("patched __emval_get_method_caller (behavioural)", () => {
  it("kind 0: calls func.call(obj, ...args) and converts a non-void return", async () => {
    const { getMethodCaller } = await loadPatchedMethodCaller();
    const retType = fakeEmvalType({ name: "int", value: undefined });
    const argType0 = fakeEmvalType({ name: "int", value: 7 });
    const caller = getMethodCaller([retType, argType0], 0);

    let seenThis: unknown;
    let seenArgs: unknown[] = [];
    const func = function (this: unknown, ...args: unknown[]) {
      seenThis = this;
      seenArgs = args;
      return 99;
    };

    const result = caller("the-obj", func, "destructorsRef", 0);
    expect(seenThis).toBe("the-obj");
    expect(seenArgs).toEqual([7]);
    expect(result).toBe(99); // fromWireType defaults to identity via fakeEmvalType? see below
  });

  it("kind 1: constructs via `new func(...args)`", async () => {
    const { getMethodCaller } = await loadPatchedMethodCaller();
    const retType = fakeEmvalType({ name: "TestClass", value: undefined });
    const argType0 = fakeEmvalType({ name: "int", value: 3 });
    const caller = getMethodCaller([retType, argType0], 1);

    class Fake {
      arg: unknown;
      constructor(arg: unknown) {
        this.arg = arg;
      }
    }

    const result = caller(
      null,
      Fake as unknown as (...args: unknown[]) => unknown,
      "destructorsRef",
      0,
    ) as Fake;
    expect(result).toBeInstanceOf(Fake);
    expect(result.arg).toBe(3);
  });

  it("kind 2 (neither 0 nor 1): calls func.call(...args), first arg as `this`", async () => {
    const { getMethodCaller } = await loadPatchedMethodCaller();
    const retType = fakeEmvalType({ name: "int", value: undefined });
    const argType0 = fakeEmvalType({ name: "int", value: "this-value" });
    const argType1 = fakeEmvalType({ name: "int", value: "second-arg" });
    const caller = getMethodCaller([retType, argType0, argType1], 2);

    let seenThis: unknown;
    let seenArgs: unknown[] = [];
    const func = function (this: unknown, ...args: unknown[]) {
      seenThis = this;
      seenArgs = args;
      return 1;
    };

    caller(null, func, "destructorsRef", 0);
    expect(seenThis).toBe("this-value");
    expect(seenArgs).toEqual(["second-arg"]);
  });

  it("does not call emval_returnValue when the return type is void", async () => {
    const { getMethodCaller } = await loadPatchedMethodCaller();
    const retType = fakeEmvalType({
      name: "void",
      value: undefined,
      isVoid: true,
    });
    const caller = getMethodCaller([retType], 0);

    const func = () => "should be ignored";

    const result = caller("obj", func, "destructorsRef", 0);
    expect(result).toBeUndefined();
  });
});
