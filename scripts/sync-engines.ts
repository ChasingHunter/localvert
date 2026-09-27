/**
 * `pnpm sync-engines` — copies each engine's assets out of the npm package
 * that owns them and into place for the build: `public/engines/<id>@<
 * version>/` for a "static" engine, `.engines-r2/xl/<id>@<version>/` (a
 * staging area, uploaded later by `scripts/upload-r2.ts`) for an "r2" one.
 * `<version>` is the installed `package`'s own version — never read from
 * `engine.json`, which may not declare one for a "static"/"r2" engine (see
 * `scripts/gen-registry.ts`) — so a Dependabot bump of an engine package
 * changes nothing here but the destination path; no engine.json edit, no
 * manual step. `pnpm gen` (chained after this script by the `sync-engines`
 * npm script) computes the same version, plus each asset's real size, for
 * `manifest.ts`.
 *
 * Placement is enforced mechanically (ADR-0003,
 * docs/adr/0003-workers-static-assets-over-pages.md): a "static" file over
 * `STATIC_LIMIT_BYTES` fails the build rather than silently shipping past
 * Cloudflare's 25 MiB static-asset limit.
 *
 * Reads only `src/lib/engines/<id>/engine.json` — never `adapter.ts` — so,
 * like `scripts/gen-registry.ts`, this script never imports or executes our
 * own code. Unlike `gen-registry.ts` it does *not* validate the full
 * engine.json contract (id-matches-dirname, asset shape, ...); that
 * is `gen-registry.ts`'s job, and `pnpm sync-engines` always runs `pnpm gen`
 * right after, so a malformed engine.json still fails the same command. This
 * script only reads the handful of fields it actually needs.
 *
 * Runs as plain `node scripts/sync-engines.ts` (Node's built-in TypeScript
 * type stripping — no build step for this script itself). Kept fully
 * self-contained — no relative imports of sibling scripts, mirroring
 * `gen-registry.ts`'s module doc comment — because "bundler" module
 * resolution requires `allowImportingTsExtensions` to import another `.ts`
 * file by its literal extension, which this repo does not enable, and Node's
 * own type stripping has no path-alias or extension-rewriting of its own to
 * fall back on. Keep it to erasable syntax only: no enums, no namespaces, no
 * parameter properties.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

/**
 * Every regular file under `dir`, recursively, as POSIX-style paths relative
 * to `dir` (e.g. `"nested/Foo.bcmap"`) — used by `copyEngineFiles`'s
 * directory-entry support below. Directory entries sort no differently from
 * single-file ones (the caller sorts the flattened result), so this doesn't
 * bother sorting its own output.
 */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const rel of listFilesRecursive(join(dir, entry.name))) {
        out.push(`${entry.name}/${rel}`);
      }
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * ADR-0003: engines ≤20 MiB ship as static assets; anything larger goes to
 * R2. 20 MiB (not the 25 MiB hard limit) leaves headroom. Overridable so
 * tests can exercise the rule with small fixture files instead of a real
 * 20 MiB one.
 */
export const STATIC_LIMIT_BYTES = 20 * 1024 * 1024;

export interface SourceFile {
  from: string;
  to: string;
  /** Overrides the engine's own `package` for this one file — see
   * `EngineSourceFile`'s doc comment in `src/lib/engines/types.ts`. */
  package?: string;
  /** Ship this file gzipped — see `EngineSourceFile.gzip`'s doc comment. */
  gzip?: boolean;
  /** Apply `patchTypstGlue`/`patchLibreOfficeEmbind` while copying — see
   * `EngineSourceFile.patch`'s doc comment. */
  patch?: "typst-glue" | "libreoffice-embind";
}

// ---------------------------------------------------------------------------
// typst glue patch (ADR-0011): CSP-safe replacement for wasm-bindgen's
// `new Function(...)` stubs
// ---------------------------------------------------------------------------

/**
 * `@myriaddreamin/typst-ts-web-compiler`'s wasm-bindgen glue
 * (`typst_ts_web_compiler.mjs`) imports two host functions the wasm module
 * calls, unconditionally, while constructing a fresh `TypstCompilerBuilder`
 * — before our own adapter ever calls `set_access_model`/`withPackageRegistry`
 * — to build its *default* ("dummy") AccessModel/Registry implementations:
 *
 * ```js
 * imports.wbg.__wbg_new_no_args_XXXXXXXX = function(arg0, arg1) {
 *   const ret = new Function(getStringFromWasm0(arg0, arg1));
 *   return addHeapObject(ret);
 * };
 * imports.wbg.__wbg_new_with_args_XXXXXXXX = function(arg0, arg1, arg2, arg3) {
 *   const ret = new Function(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
 *   return addHeapObject(ret);
 * };
 * ```
 *
 * `new Function(string)` is a string-eval sink — CSP's `script-src` (no
 * `unsafe-eval`) blocks it outright, which is what actually fails today
 * ("Evaluating a string as JavaScript violates ... 'unsafe-eval'"). The
 * *only* strings the wasm module ever passes to these two imports (verified
 * by grepping the real `_bg.wasm`'s string literals: `"return 0"`,
 * `"return true"`, `"path"`/`"return path"`, and two `Dummy
 * AccessModel`/`Dummy Registry` throw-stubs) are five fixed dummy-method
 * bodies — never markdown, never anything derived from the file being
 * compiled. This patch replaces the two import functions' bodies with a
 * closed lookup over exactly those five (args, body) pairs, each mapped to a
 * pre-written static function, and made to *fail closed*: any other body
 * throws instead of silently doing nothing, so a typst-ts upgrade that adds
 * a sixth dummy stub breaks the build loudly (in `assertPatchedTypstGlue`,
 * and again at runtime if that somehow slipped through) instead of shipping
 * a compiler that quietly can't ever hit that new stub.
 *
 * Regex-matched on the stable generated-name shape
 * (`__wbg_new_no_args_[0-9a-f]+`/`__wbg_new_with_args_[0-9a-f]+`) rather than
 * today's exact hex suffix, which wasm-bindgen regenerates on every typst-ts
 * build. `syncEngines` asserts each regex matches **exactly once** before
 * trusting the patch — see `assertPatchedTypstGlue`.
 */
const NO_ARGS_IMPORT_RE =
  /imports\.wbg\.(__wbg_new_no_args_[0-9a-f]+) = function\(arg0, arg1\) \{\n\s*const ret = new Function\(getStringFromWasm0\(arg0, arg1\)\);\n\s*return addHeapObject\(ret\);\n\s*\};/;

const WITH_ARGS_IMPORT_RE =
  /imports\.wbg\.(__wbg_new_with_args_[0-9a-f]+) = function\(arg0, arg1, arg2, arg3\) \{\n\s*const ret = new Function\(getStringFromWasm0\(arg0, arg1\), getStringFromWasm0\(arg2, arg3\)\);\n\s*return addHeapObject\(ret\);\n\s*\};/;

/** Inserted once, right before the first patched import, so both patched
 * assignments below can call it. Plain string switches over the five known
 * dummy bodies typst-ts's wasm actually requests — no `new Function`, no
 * `eval`, nothing string-evaluated. */
const SAFE_FUNCTION_PREAMBLE = `
// --- localvert: CSP-safe replacement for wasm-bindgen's Function-constructor
// stubs (see scripts/sync-engines.ts's patchTypstGlue) ---
function __localvertSafeFunctionNoArgs(body) {
    switch (body) {
        case "return 0": return () => 0;
        case "return true": return () => true;
        case "throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')":
            return () => { throw new Error("Dummy AccessModel, please initialize compiler with withAccessModel()"); };
        case "throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')":
            return () => { throw new Error("Dummy Registry, please initialize compiler with withPackageRegistry()"); };
        default:
            throw new Error("localvert: refusing to evaluate a string as code: " + body.slice(0, 80));
    }
}
function __localvertSafeFunctionWithArgs(args, body) {
    if (args === "path" && body === "return path") return (path) => path;
    throw new Error("localvert: refusing to evaluate a string as code: " + body.slice(0, 80));
}
`;

/**
 * Applies the transform described above to `source` (the raw
 * `typst_ts_web_compiler.mjs` text). Throws (fail closed) if either import
 * doesn't match **exactly once** — a typst-ts upgrade that changes this
 * glue's shape must fail `pnpm sync-engines` loudly rather than ship
 * unpatched. Also asserts the *output* contains no `new Function(` at all,
 * as a second, independent guard.
 */
export function patchTypstGlue(source: string): string {
  const fail = (message: string): never => {
    throw new Error(`[sync-engines] patchTypstGlue: ${message}`);
  };

  const noArgsMatches = source.match(new RegExp(NO_ARGS_IMPORT_RE, "g"));
  if (noArgsMatches === null || noArgsMatches.length !== 1) {
    fail(
      `expected exactly one __wbg_new_no_args_* import, found ${noArgsMatches?.length ?? 0} — typst-ts glue shape changed, patch needs updating`,
    );
  }
  const withArgsMatches = source.match(new RegExp(WITH_ARGS_IMPORT_RE, "g"));
  if (withArgsMatches === null || withArgsMatches.length !== 1) {
    fail(
      `expected exactly one __wbg_new_with_args_* import, found ${withArgsMatches?.length ?? 0} — typst-ts glue shape changed, patch needs updating`,
    );
  }

  const noArgsMatch = source.match(NO_ARGS_IMPORT_RE);
  if (!noArgsMatch)
    fail("__wbg_new_no_args_* did not match on the second pass");
  const [, noArgsName] = noArgsMatch as RegExpMatchArray;

  let patched = source.replace(
    NO_ARGS_IMPORT_RE,
    `${SAFE_FUNCTION_PREAMBLE}imports.wbg.${noArgsName} = function(arg0, arg1) {
    const ret = __localvertSafeFunctionNoArgs(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
};`,
  );

  const withArgsMatch = patched.match(WITH_ARGS_IMPORT_RE);
  if (!withArgsMatch)
    fail("__wbg_new_with_args_* did not match on the second pass");
  const [, withArgsName] = withArgsMatch as RegExpMatchArray;

  patched = patched.replace(
    WITH_ARGS_IMPORT_RE,
    `imports.wbg.${withArgsName} = function(arg0, arg1, arg2, arg3) {
    const ret = __localvertSafeFunctionWithArgs(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
    return addHeapObject(ret);
};`,
  );

  if (patched.includes("new Function(")) {
    fail('patched output still contains "new Function(" — patch is incomplete');
  }

  return patched;
}

// ---------------------------------------------------------------------------
// libreoffice embind patch (ADR-0012): CSP-safe replacement for embind's
// runtime code generation
// ---------------------------------------------------------------------------

/**
 * `@bentopdf/libreoffice-wasm`'s `assets/soffice.js` (an Emscripten build of
 * LibreOffice, built *without* `-sDYNAMIC_EXECUTION=0`) has exactly two
 * runtime code-generation sites, both routed through the same `newFunc`
 * helper (`newFunc(Function, args)(...closureArgs)`, effectively
 * `new Function(...)` via `Function.apply`):
 *
 * 1. `craftInvokerFunction`, embind's generic "call this bound C++ function"
 *    invoker factory — used for every bound class method, constructor and
 *    free function. It builds a source string via `createJsInvoker` and
 *    hands it to `newFunc(Function, args)`.
 * 2. `__emval_get_method_caller`, the emval helper behind calling a bound
 *    JS method/constructor from C++ (`val::call`, `EM_ASM`-adjacent glue) —
 *    same pattern, its own generated `functionBody` string.
 *
 * Both are exactly what Emscripten's own `-sDYNAMIC_EXECUTION=0` build flag
 * replaces with eval-free closures — this build just wasn't compiled with
 * that flag. This patch ports those closures by hand: same argument-count
 * check, `this`/wire-type handling, destructor bookkeeping and return
 * conversion as the *generated* body would perform, just written directly
 * instead of assembled as a string and passed to `new Function`.
 *
 * Matched on the exact literal source of each function (not a regex over a
 * generated-name shape, unlike `patchTypstGlue` — neither function here has
 * a hash suffix; Emscripten emits both verbatim). `syncEngines` asserts each
 * literal appears **exactly once** before trusting the patch — see
 * `assertLibreOfficeEmbindPatched`'s use of `source.split(...).length`. A
 * `libreoffice-wasm` upgrade that reshapes either function fails
 * `pnpm sync-engines` loudly instead of silently shipping unpatched
 * (CSP-blocked) code.
 */
const OLD_CRAFT_INVOKER_FUNCTION =
  'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and \'this\' types!")}assert(!isAsync,"Async bindings are only supported with JSPI.");var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=usesDestructorStack(argTypes);var returns=argTypes[0].name!=="void";var expectedArgCount=argCount-2;var minArgs=getRequiredArgCount(argTypes);var closureArgs=[humanName,throwBindingError,cppInvokerFunc,cppTargetFunc,runDestructors,argTypes[0],argTypes[1]];for(var i=0;i<argCount-2;++i){closureArgs.push(argTypes[i+2])}if(!needsDestructorStack){for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){if(argTypes[i].destructorFunction!==null){closureArgs.push(argTypes[i].destructorFunction)}}}closureArgs.push(checkArgCount,minArgs,expectedArgCount);let[args,invokerFnBody]=createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync);args.push(invokerFnBody);var invokerFn=newFunc(Function,args)(...closureArgs);return createNamedFunction(humanName,invokerFn)}';

/**
 * Eval-free replacement. Reproduces exactly what the generated
 * `invokerFnBody` (see `createJsInvoker` in the same file) does: check the
 * call's argument count, wire `this` (for a class method) and each argument
 * through its type's `toWireType`, invoke the real C++ trampoline, run
 * destructors (batched via a shared stack when any wired argument needs
 * one, else per-argument via each type's own `destructorFunction`), then
 * convert and return the result via the return type's `fromWireType` — all
 * with per-call local state, never anything shared across reentrant calls.
 */
const NEW_CRAFT_INVOKER_FUNCTION = `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){
var argCount=argTypes.length;
if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}
assert(!isAsync,"Async bindings are only supported with JSPI.");
var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
var needsDestructorStack=usesDestructorStack(argTypes);
var returns=argTypes[0].name!=="void";
var expectedArgCount=argCount-2;
var minArgs=getRequiredArgCount(argTypes);
var retType=argTypes[0];
var classParam=argTypes[1];
function invokerFunction(...callArgs){
checkArgCount(callArgs.length,minArgs,expectedArgCount,humanName,throwBindingError);
var destructors=needsDestructorStack?[]:null;
var invokerArgs=[cppTargetFunc];
var thisWired;
if(isClassMethodFunc){thisWired=classParam["toWireType"](destructors,this);invokerArgs.push(thisWired)}
var argsWired=[];
for(var i=0;i<expectedArgCount;++i){
var argType=argTypes[i+2];
var argWired=argType["toWireType"](destructors,callArgs[i]);
argsWired.push(argWired);
invokerArgs.push(argWired);
}
var rv=cppInvokerFunc(...invokerArgs);
if(needsDestructorStack){runDestructors(destructors)}
else{
for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){
var paramName=i===1?thisWired:argsWired[i-2];
var destructorFunction=argTypes[i].destructorFunction;
if(destructorFunction!==null){destructorFunction(paramName)}
}
}
if(returns){var ret=retType["fromWireType"](rv);return ret}
}
return createNamedFunction(humanName,invokerFunction)
}`;

const OLD_EMVAL_METHOD_CALLER =
  'function __emval_get_method_caller(argCount,argTypes,kind){argTypes>>>=0;var types=emval_lookupTypes(argCount,argTypes);var retType=types.shift();argCount--;var functionBody=`return function (obj, func, destructorsRef, args) {\\n`;var offset=0;var argsList=[];if(kind===0){argsList.push("obj")}var params=["retType"];var args=[retType];for(var i=0;i<argCount;++i){argsList.push("arg"+i);params.push("argType"+i);args.push(types[i]);functionBody+=`  var arg${i} = argType${i}.readValueFromPointer(args${offset?"+"+offset:""});\\n`;offset+=types[i].argPackAdvance}var invoker=kind===1?"new func":"func.call";functionBody+=`  var rv = ${invoker}(${argsList.join(", ")});\\n`;if(!retType.isVoid){params.push("emval_returnValue");args.push(emval_returnValue);functionBody+="  return emval_returnValue(retType, destructorsRef, rv);\\n"}functionBody+="};\\n";params.push(functionBody);var invokerFunction=newFunc(Function,params)(...args);var functionName=`methodCaller<(${types.map(t=>t.name).join(", ")}) => ${retType.name}>`;return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))}';

/**
 * Eval-free replacement. Reproduces exactly what the generated
 * `functionBody` does: read each argument's wire value off the `args`
 * pointer packet (advancing `offset` by each type's own
 * `argPackAdvance`, matching the generated `args${offset?"+"+offset:""}`
 * indexing), dispatch as a construct (`kind===1`), a method call on `obj`
 * (`kind===0`), or a plain call with the first argument as `this`
 * (anything else — mirrors the generated `func.call(arg0, ...)` with no
 * `obj` in scope), and, unless the return type is void, convert the result
 * through `emval_returnValue`.
 */
const NEW_EMVAL_METHOD_CALLER = `function __emval_get_method_caller(argCount,argTypes,kind){
argTypes>>>=0;
var types=emval_lookupTypes(argCount,argTypes);
var retType=types.shift();
argCount--;
function invokerFunction(obj,func,destructorsRef,args){
var offset=0;
var callArgs=[];
for(var i=0;i<argCount;++i){
var argType=types[i];
var arg=argType.readValueFromPointer(offset?args+offset:args);
callArgs.push(arg);
offset+=argType.argPackAdvance;
}
var rv;
if(kind===1){rv=new func(...callArgs)}
else if(kind===0){rv=func.call(obj,...callArgs)}
else{rv=func.call(...callArgs)}
if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}
}
var functionName=\`methodCaller<(\${types.map(t=>t.name).join(", ")}) => \${retType.name}>\`;
return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))
}`;

/**
 * Applies the transform described above to `source` (the raw `soffice.js`
 * text). Throws (fail closed) if either literal doesn't match **exactly
 * once** — a `libreoffice-wasm` upgrade that changes either function's shape
 * must fail `pnpm sync-engines` loudly rather than ship unpatched. Also
 * asserts the *output* contains no `newFunc(Function` (the pattern both
 * sites used to invoke the dynamic `Function` constructor through) and no
 * `new Function(`, as a second, independent guard.
 */
export function patchLibreOfficeEmbind(source: string): string {
  const fail = (message: string): never => {
    throw new Error(`[sync-engines] patchLibreOfficeEmbind: ${message}`);
  };

  const craftCount = source.split(OLD_CRAFT_INVOKER_FUNCTION).length - 1;
  if (craftCount !== 1) {
    fail(
      `expected exactly one craftInvokerFunction, found ${craftCount} — libreoffice-wasm's embind glue shape changed, patch needs updating`,
    );
  }
  const methodCallerCount = source.split(OLD_EMVAL_METHOD_CALLER).length - 1;
  if (methodCallerCount !== 1) {
    fail(
      `expected exactly one __emval_get_method_caller, found ${methodCallerCount} — libreoffice-wasm's embind glue shape changed, patch needs updating`,
    );
  }

  let patched = source.replace(
    OLD_CRAFT_INVOKER_FUNCTION,
    NEW_CRAFT_INVOKER_FUNCTION,
  );
  patched = patched.replace(OLD_EMVAL_METHOD_CALLER, NEW_EMVAL_METHOD_CALLER);

  if (patched.includes("newFunc(Function")) {
    fail(
      'patched output still contains "newFunc(Function" — patch is incomplete',
    );
  }
  if (patched.includes("new Function(")) {
    fail('patched output still contains "new Function(" — patch is incomplete');
  }

  return patched;
}

/** Dispatch table for `SourceFile.patch`. */
const PATCHES: Record<
  "typst-glue" | "libreoffice-embind",
  (source: string) => string
> = {
  "typst-glue": patchTypstGlue,
  "libreoffice-embind": patchLibreOfficeEmbind,
};

/**
 * The handful of `engine.json` fields this script reads. Not the full
 * contract — see the module doc comment. No `version` field: for the
 * "static"/"r2" engines this script actually processes, the version is
 * always derived from the installed `package` (see `resolveVersion`), never
 * read from `engine.json` — that's the whole point (a Dependabot bump of the
 * package changes nothing here).
 */
export interface EngineSource {
  id: string;
  location: "native" | "static" | "r2" | "bundled";
  package?: string;
  files?: readonly SourceFile[];
}

export interface SyncedFile {
  /** The `to` path, relative to the engine's asset directory. */
  path: string;
  bytes: number;
}

export interface SyncedEngine {
  id: string;
  version: string;
  location: "static" | "r2";
  files: readonly SyncedFile[];
}

export interface SyncResult {
  engines: readonly SyncedEngine[];
  /** `public/engines/<id>@<oldVersion>` directories removed as stale. */
  removedStaleDirs: readonly string[];
  warnings: readonly string[];
}

/** `bytes` as MiB, one decimal place — matches how ADR-0003's limits are stated. */
function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Reads `src/lib/engines/<id>/engine.json` down to the fields this script
 * needs. Throws with a `[sync-engines]`-prefixed message on anything this
 * script itself depends on being well-formed; anything else is left for
 * `gen-registry.ts`'s fuller validation.
 */
function readEngineSource(dir: string, id: string): EngineSource {
  const fail = (message: string): never => {
    throw new Error(`[sync-engines] engine "${id}": ${message}`);
  };

  const raw = readFileSync(join(dir, "engine.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    fail("engine.json must be a JSON object");
  }
  const j = parsed as Record<string, unknown>;

  if (
    j.location !== "native" &&
    j.location !== "static" &&
    j.location !== "r2" &&
    j.location !== "bundled"
  ) {
    fail(`"location" must be one of native, static, r2, bundled`);
  }
  const location = j.location as "native" | "static" | "r2" | "bundled";

  // Neither ships assets of its own — nothing for this script to copy.
  if (location === "native" || location === "bundled") {
    return { id, location };
  }

  if (typeof j.package !== "string" || j.package === "") {
    fail(`"package" must be a non-empty string`);
  }
  if (!Array.isArray(j.files) || j.files.length === 0) {
    fail(`"files" must be a non-empty array`);
  }
  const files = (j.files as unknown[]).map((f, i) => {
    const file = f as Record<string, unknown>;
    if (typeof file.from !== "string" || typeof file.to !== "string") {
      fail(`"files[${i}]" must have string "from" and "to"`);
    }
    if (file.package !== undefined && typeof file.package !== "string") {
      fail(`"files[${i}].package" must be a string`);
    }
    if (file.gzip !== undefined && typeof file.gzip !== "boolean") {
      fail(`"files[${i}].gzip" must be a boolean`);
    }
    if (
      file.patch !== undefined &&
      file.patch !== "typst-glue" &&
      file.patch !== "libreoffice-embind"
    ) {
      fail(
        `"files[${i}].patch" must be "typst-glue" or "libreoffice-embind" if present`,
      );
    }
    return {
      from: file.from as string,
      to: file.to as string,
      ...(file.package !== undefined
        ? { package: file.package as string }
        : {}),
      ...(file.gzip !== undefined ? { gzip: file.gzip as boolean } : {}),
      ...(file.patch !== undefined
        ? { patch: file.patch as "typst-glue" | "libreoffice-embind" }
        : {}),
    };
  });

  return {
    id,
    location,
    package: j.package as string,
    files,
  };
}

/** Every `src/lib/engines/<id>/` directory that has an `engine.json`. */
export function scanEngineSources(rootDir: string): EngineSource[] {
  const enginesDir = join(rootDir, "src", "lib", "engines");
  if (!existsSync(enginesDir)) return [];

  const ids = readdirSync(enginesDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && existsSync(join(enginesDir, d.name, "engine.json")),
    )
    .map((d) => d.name)
    .sort();

  return ids.map((id) => readEngineSource(join(enginesDir, id), id));
}

/**
 * Resolves the on-disk directory of an installed npm package. Tries
 * `require.resolve` first (works even for a package whose `exports` map
 * happens to expose `./package.json`); a package whose `exports` blocks that
 * subpath makes `require.resolve` throw even though the package is
 * installed, so this falls back to the conventional `node_modules/<pkg>`
 * layout. `paths: [rootDir]` — rather than resolving relative to this
 * script's own location — is what makes this testable against a fixture
 * `rootDir` with its own `node_modules`.
 */
export function resolvePackageDir(pkg: string, rootDir: string): string {
  const require = createRequire(import.meta.url);
  try {
    return dirname(
      require.resolve(`${pkg}/package.json`, { paths: [rootDir] }),
    );
  } catch {
    const fallback = join(rootDir, "node_modules", ...pkg.split("/"));
    if (existsSync(join(fallback, "package.json"))) return fallback;
    throw new Error(
      `[sync-engines] cannot resolve package "${pkg}" from ${rootDir} — is it installed?`,
    );
  }
}

function readInstalledVersion(packageDir: string): string {
  const pkgJsonPath = join(packageDir, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof pkgJson.version !== "string") {
    fail(`"${pkgJsonPath}" has no "version" field`);
  }
  return pkgJson.version as string;
}

function fail(message: string): never {
  throw new Error(`[sync-engines] ${message}`);
}

/** Where one engine's synced files land, by location. `version` is the
 * installed package's own version (see `syncEngines`), never read from
 * `engine.json`. */
function destRoot(
  rootDir: string,
  source: EngineSource,
  version: string,
): string {
  const dirName = `${source.id}@${version}`;
  return source.location === "static"
    ? join(rootDir, "public", "engines", dirName)
    : join(rootDir, ".engines-r2", "xl", dirName);
}

/** Copies one file, enforcing the ADR-0003 placement rule for a "static"
 * engine. `to` is the path (relative to the engine's asset directory) it
 * lands under — a plain filename for a single-file entry, or a directory
 * entry's own `to` prefix plus a file's path within it. */
function copyOneFile(
  srcPath: string,
  dest: string,
  to: string,
  engineId: string,
  location: "static" | "r2",
  staticLimitBytes: number,
  transform?: Pick<SourceFile, "gzip" | "patch">,
): SyncedFile {
  const destPath = join(dest, ...to.split("/"));
  mkdirSync(dirname(destPath), { recursive: true });

  let bytes: Buffer = readFileSync(srcPath);
  if (transform?.patch !== undefined) {
    bytes = Buffer.from(
      PATCHES[transform.patch](bytes.toString("utf8")),
      "utf8",
    );
  }
  if (transform?.gzip === true) {
    // Deterministic: same input bytes always produce the same gzip output
    // (node's zlib doesn't embed a timestamp at this level — mtime defaults
    // to 0 unless a Gzip-specific option sets it).
    bytes = gzipSync(bytes, { level: 9 });
  }
  writeFileSync(destPath, bytes);
  const size = statSync(destPath).size;

  if (location === "static" && size > staticLimitBytes) {
    fail(
      `${engineId}/${to} is ${mib(size)} MiB; static assets are capped at 25 MiB by Cloudflare — set location to r2`,
    );
  }
  return { path: to, bytes: size };
}

/**
 * Copies one engine's files from its package directory to `destRoot`,
 * enforcing the ADR-0003 placement rule for a "static" engine. Returns the
 * copied files, sorted by `path`.
 *
 * A `from`/`to` pair where **both** end in `"/"` is a directory entry (e.g.
 * `{from: "cmaps/", to: "cmaps/"}`, for an engine like `pdfjs` whose cmaps/
 * standard-fonts assets are a whole directory tree, not a fixed file list) —
 * every file under `from`, recursively, is copied to the matching path under
 * `to`, and each one becomes its own `SyncedFile` entry (so `engine.json`'s
 * `assets` ends up listing every individual file, same as a hand-written
 * `files` entry would, never a directory as one opaque blob).
 */
function copyEngineFiles(
  rootDir: string,
  packageDir: string,
  dest: string,
  source: EngineSource & { location: "static" | "r2" },
  staticLimitBytes: number,
): SyncedFile[] {
  // Caches each override package's resolved directory — several files often
  // borrow from the same non-primary package (e.g. tesseract's four
  // tesseract.js-core files), and `resolvePackageDir` does real filesystem
  // resolution.
  const packageDirs = new Map<string, string>();
  const resolveFilePackageDir = (fileSource: SourceFile): string => {
    if (fileSource.package === undefined) return packageDir;
    // "local" is a sentinel, not a real npm specifier: it resolves a file
    // from this repo's own `vendor/` tree (e.g. typst's vendored fonts and
    // cmarker package — files with no owning npm package at all) instead of
    // `node_modules`. `from` is then relative to `rootDir` directly.
    if (fileSource.package === "local") return rootDir;
    const cached = packageDirs.get(fileSource.package);
    if (cached) return cached;
    const resolved = resolvePackageDir(fileSource.package, rootDir);
    packageDirs.set(fileSource.package, resolved);
    return resolved;
  };

  const files: SyncedFile[] = [];
  for (const fileSource of source.files ?? []) {
    const { from, to } = fileSource;
    if (from.endsWith("/") !== to.endsWith("/")) {
      fail(
        `${source.id}: a directory entry's "from" and "to" must both end with "/" (got from="${from}", to="${to}")`,
      );
    }
    const fromPackageDir = resolveFilePackageDir(fileSource);

    if (from.endsWith("/")) {
      const srcDir = join(fromPackageDir, ...from.split("/"));
      for (const rel of listFilesRecursive(srcDir)) {
        files.push(
          copyOneFile(
            join(srcDir, ...rel.split("/")),
            dest,
            `${to}${rel}`,
            source.id,
            source.location,
            staticLimitBytes,
          ),
        );
      }
      continue;
    }

    const srcPath = join(fromPackageDir, ...from.split("/"));
    files.push(
      copyOneFile(
        srcPath,
        dest,
        to,
        source.id,
        source.location,
        staticLimitBytes,
        { gzip: fileSource.gzip, patch: fileSource.patch },
      ),
    );
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Removes `public/engines/<id>@<oldVersion>` directories for every "static"
 * engine we own whose current (installed) version has moved on — otherwise
 * a version bump leaves the old build artifact behind forever, since nothing
 * else ever deletes it. `versions` maps each source's `id` to its resolved
 * version (see `syncEngines`).
 */
function cleanStaleStaticDirs(
  rootDir: string,
  staticSources: readonly EngineSource[],
  versions: ReadonlyMap<string, string>,
): string[] {
  const publicEnginesDir = join(rootDir, "public", "engines");
  if (!existsSync(publicEnginesDir)) return [];

  const keep = new Set(
    staticSources.map((s) => `${s.id}@${versions.get(s.id)}`),
  );
  const ownedIds = new Set(staticSources.map((s) => s.id));
  const removed: string[] = [];

  for (const entry of readdirSync(publicEnginesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const atIndex = entry.name.lastIndexOf("@");
    if (atIndex === -1) continue;
    const ownerId = entry.name.slice(0, atIndex);
    if (!ownedIds.has(ownerId) || keep.has(entry.name)) continue;
    rmSync(join(publicEnginesDir, entry.name), {
      recursive: true,
      force: true,
    });
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Syncs every "static"/"r2" engine's assets into place. Pure aside from the
 * filesystem effects the doc comment above describes — no network I/O, no
 * child process. `staticLimitBytes` defaults to `STATIC_LIMIT_BYTES`;
 * overridable so tests can exercise the placement rule without a real
 * 20 MiB fixture file.
 */
export function syncEngines(
  rootDir: string,
  staticLimitBytes: number = STATIC_LIMIT_BYTES,
): SyncResult {
  const sources = scanEngineSources(rootDir).filter(
    (s): s is EngineSource & { location: "static" | "r2" } =>
      s.location === "static" || s.location === "r2",
  );

  const engines: SyncedEngine[] = [];
  const warnings: string[] = [];
  const versions = new Map<string, string>();

  for (const source of sources) {
    // `package` is guaranteed by `readEngineSource` for a static/r2 engine —
    // its installed version *is* this engine's version, full stop. Nothing
    // in engine.json to compare it against, so a dependency bump changes
    // nothing here but this one lookup.
    const packageDir = resolvePackageDir(source.package as string, rootDir);
    const version = readInstalledVersion(packageDir);
    versions.set(source.id, version);

    const dest = destRoot(rootDir, source, version);
    const files = copyEngineFiles(
      rootDir,
      packageDir,
      dest,
      source,
      staticLimitBytes,
    );

    if (
      source.location === "r2" &&
      files.every((f) => f.bytes < staticLimitBytes)
    ) {
      warnings.push(
        `engine "${source.id}" is r2 but every file is under ${mib(staticLimitBytes)} MiB — consider setting location to "static".`,
      );
    }

    engines.push({
      id: source.id,
      version,
      location: source.location,
      files,
    });
  }

  const removedStaleDirs = cleanStaleStaticDirs(
    rootDir,
    sources.filter((s) => s.location === "static"),
    versions,
  );

  return { engines, removedStaleDirs, warnings };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = process.cwd();

  let result: SyncResult;
  try {
    result = syncEngines(rootDir);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (result.engines.length === 0) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log("sync-engines: no static/r2 engines to sync — nothing to do.");
    return;
  }

  const idCol = Math.max(6, ...result.engines.map((e) => e.id.length));
  // biome-ignore lint/suspicious/noConsole: this is the report table, stdout is the product here.
  console.log(
    `${"Engine".padEnd(idCol)}  ${"Version".padEnd(10)}  Location  Files  Bytes`,
  );
  for (const engine of result.engines) {
    const totalBytes = engine.files.reduce((sum, f) => sum + f.bytes, 0);
    // biome-ignore lint/suspicious/noConsole: this is the report table, stdout is the product here.
    console.log(
      `${engine.id.padEnd(idCol)}  ${engine.version.padEnd(10)}  ${engine.location.padEnd(8)}  ${String(engine.files.length).padStart(5)}  ${String(totalBytes).padStart(9)}`,
    );
  }

  for (const dir of result.removedStaleDirs) {
    // biome-ignore lint/suspicious/noConsole: this is the script's own completion summary.
    console.log(`sync-engines: removed stale public/engines/${dir}.`);
  }
  for (const warning of result.warnings) {
    console.warn(`sync-engines: warning: ${warning}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
