import { describe, expect, it } from "vitest";
import { findEvalCalls, isAllowedBySnippet } from "./check-engine-eval";

describe("findEvalCalls", () => {
  it("finds new Function with its offset", () => {
    const src = 'var a=1;new Function("return this")()';
    expect(findEvalCalls(src)).toEqual([{ kind: "new Function", offset: 8 }]);
  });

  it("tolerates whitespace in new Function ( and eval (", () => {
    expect(findEvalCalls("new  Function (x)").map((h) => h.kind)).toEqual([
      "new Function",
    ]);
    expect(findEvalCalls("eval (x)").map((h) => h.kind)).toEqual(["eval"]);
  });

  it("finds bare and member eval calls", () => {
    const count = findEvalCalls("eval(a);window.eval(b);(0,eval)(c)").length;
    expect(count).toBe(2); // `(0,eval)(` has no call directly on the identifier
  });

  it("ignores identifiers that merely contain eval", () => {
    const src = "a.evaluate(1);retrieval(2);$eval(3);my_eval(4);evaluate(5)";
    expect(findEvalCalls(src)).toEqual([]);
  });

  it("ignores Function without new and plain mentions", () => {
    expect(findEvalCalls("x instanceof Function;Function.prototype")).toEqual(
      [],
    );
  });
});

describe("isAllowedBySnippet", () => {
  const list = [
    { snippet: "runInThisContext=function(){return eval(this.code)}" },
  ];
  const shim =
    "a();Script.prototype.runInThisContext=function(){return eval(this.code)};";

  it("allows an eval inside a listed snippet", () => {
    const [hit] = findEvalCalls(shim);
    expect(hit && isAllowedBySnippet(shim, hit, list)).toBe(true);
  });

  it("still flags an eval elsewhere in the same file", () => {
    const src = `${shim}eval(userCode)`;
    const hits = findEvalCalls(src);
    expect(hits.map((h) => isAllowedBySnippet(src, h, list))).toEqual([
      true,
      false,
    ]);
  });
});
