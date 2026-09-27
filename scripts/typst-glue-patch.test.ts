import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { patchTypstGlue } from "./sync-engines";

/**
 * `patchTypstGlue`'s job is described in full in `sync-engines.ts`'s doc
 * comment above it (ADR-0011): wasm-bindgen's glue for
 * `@myriaddreamin/typst-ts-web-compiler` embeds two `new Function(string)`
 * calls — CSP's `script-src` (no `unsafe-eval`) blocks those outright, which
 * is the actual failure this exists to fix. These tests exercise the patch
 * against a small fixture snippet (so the regex/lookup logic is pinned down
 * independent of the real, 60 KB glue file) and, separately, the real
 * installed package (so a typst-ts upgrade that reshapes the glue fails this
 * suite, not silently in the browser).
 */

/** A trimmed-down stand-in for the real glue's shape: the two import
 * assignments this patch targets, plus unrelated surrounding code the regex
 * must leave untouched. Mirrors the real file's exact formatting (4-space
 * indent inside the function bodies, LF line endings). */
const FIXTURE = `function getStringFromWasm0(a, b) { return globalThis.__testGetStringFromWasm0(a, b); }
function addHeapObject(o) { return o; }

function getImports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_something_unrelated_deadbeef = function(arg0) {
        return addHeapObject(arg0);
    };
    imports.wbg.__wbg_new_no_args_cb138f77cf6151ee = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
    };
    imports.wbg.__wbg_new_with_args_df9e7125ffe55248 = function(arg0, arg1, arg2, arg3) {
        const ret = new Function(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
        return addHeapObject(ret);
    };
    return imports;
}
`;

/** Loads a patched fixture as a real module (via a data: URL — no bare
 * `eval`/`new Function` of untrusted content, just this test proving the
 * *patched output* behaves correctly at runtime) and returns its `imports`
 * object, with `getStringFromWasm0`/`addHeapObject` stubbed. */
async function loadPatchedImports(
  patched: string,
  getStringFromWasm0: (a: number, b: number) => string,
): Promise<Record<string, (...args: number[]) => unknown>> {
  const module = `
    ${patched}
    export { getImports };
  `;
  const url = `data:text/javascript;base64,${Buffer.from(module).toString("base64")}`;
  const mod = (await import(url)) as {
    getImports: () => { wbg: Record<string, unknown> };
  };
  // The real glue closes over its own module-scope `getStringFromWasm0`; the
  // fixture above takes it as an ordinary function declared at module scope
  // too, so we just monkey-patch it in before calling getImports().
  const globalAny = globalThis as Record<string, unknown>;
  globalAny.__testGetStringFromWasm0 = getStringFromWasm0;
  const imports = mod.getImports().wbg as Record<
    string,
    (...args: number[]) => unknown
  >;
  return imports;
}

/** Invokes `imports[name](...args)`, typed as a callable — the object
 * literal above is a plain `Record`, so TypeScript otherwise sees every
 * property access as possibly `undefined`. */
function call(
  imports: Record<string, (...args: number[]) => unknown>,
  name: string,
  ...args: number[]
): unknown {
  const fn = imports[name];
  if (!fn) throw new Error(`no import named "${name}"`);
  return fn(...args);
}

describe("patchTypstGlue", () => {
  it("replaces both Function-constructor stubs and leaves the rest untouched", () => {
    const patched = patchTypstGlue(FIXTURE);

    expect(patched).not.toContain("new Function(");
    expect(patched).toContain("__localvertSafeFunctionNoArgs");
    expect(patched).toContain("__localvertSafeFunctionWithArgs");
    expect(patched).toContain("__wbg_something_unrelated_deadbeef");
    expect(patched).toContain(
      "imports.wbg.__wbg_new_no_args_cb138f77cf6151ee =",
    );
    expect(patched).toContain(
      "imports.wbg.__wbg_new_with_args_df9e7125ffe55248 =",
    );
  });

  it("reproduces every real dummy body's behaviour without evaluating a string", async () => {
    const patched = patchTypstGlue(FIXTURE);
    const imports = await loadPatchedImports(patched, () => "return 0");
    const fn = call(
      imports,
      "__wbg_new_no_args_cb138f77cf6151ee",
      0,
      0,
    ) as () => number;

    expect(fn()).toBe(0);
  });

  it("fails closed on an unrecognized body", async () => {
    const patched = patchTypstGlue(FIXTURE);
    const imports = await loadPatchedImports(
      patched,
      () => "some unrecognized body",
    );

    expect(() =>
      call(imports, "__wbg_new_no_args_cb138f77cf6151ee", 0, 0),
    ).toThrow(/refusing to evaluate a string as code/);
  });

  it("throws if the no-args import is missing (fails the build loudly)", () => {
    const withoutNoArgs = FIXTURE.replace(
      /imports\.wbg\.__wbg_new_no_args_cb138f77cf6151ee[\s\S]*?\};\n/,
      "",
    );
    expect(() => patchTypstGlue(withoutNoArgs)).toThrow(
      /expected exactly one __wbg_new_no_args_\* import, found 0/,
    );
  });

  it("throws if the with-args import is missing", () => {
    const withoutWithArgs = FIXTURE.replace(
      /imports\.wbg\.__wbg_new_with_args_df9e7125ffe55248[\s\S]*?\};\n/,
      "",
    );
    expect(() => patchTypstGlue(withoutWithArgs)).toThrow(
      /expected exactly one __wbg_new_with_args_\* import, found 0/,
    );
  });

  it("throws if an import appears twice (ambiguous match)", () => {
    const duplicated = FIXTURE + FIXTURE;
    expect(() => patchTypstGlue(duplicated)).toThrow(
      /expected exactly one __wbg_new_no_args_\* import, found 2/,
    );
  });

  it("the real installed package's glue patches cleanly with zero remaining new Function(", () => {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve(
      "@myriaddreamin/typst-ts-web-compiler/package.json",
    );
    const glueDir = dirname(pkgJsonPath);
    const real = readFileSync(
      join(glueDir, "pkg", "typst_ts_web_compiler.mjs"),
      "utf8",
    );

    const patched = patchTypstGlue(real);

    expect(patched).not.toContain("new Function(");
    expect(patched).toContain("__localvertSafeFunctionNoArgs");
    expect(patched).toContain("__localvertSafeFunctionWithArgs");
  });
});
