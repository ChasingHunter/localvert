import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "@/lib/registry/define-tool";
import type { RunRequest } from "./protocol";
import { createToolOptionsResolver } from "./tool-options";

const tool = defineTool({
  slug: "demo",
  category: "image",
  title: "Demo",
  description: "Demo tool.",
  accepts: ["jpg"],
  produces: "png",
  options: z.object({
    quality: z.number().int().min(1).max(100).default(80),
  }),
  defaults: { quality: 80 },
  pipeline: [{ op: "transcode", candidates: [{ engine: "canvas" }] }],
  batch: true,
});

function request(over: Partial<RunRequest> = {}): RunRequest {
  return {
    jobId: "j1",
    input: { kind: "blob", blob: new Blob(["x"]) },
    steps: [],
    options: {},
    ...over,
  };
}

describe("createToolOptionsResolver", () => {
  const loader = vi.fn(async () => ({ default: tool }));
  const resolve = createToolOptionsResolver({ demo: loader });

  it("passes a request without a toolSlug through untouched", async () => {
    const req = request({ options: { anything: 1 } });
    expect(await resolve(req)).toEqual({ ok: true, req });
  });

  it("replaces options with the schema-parsed object (defaults applied, unknown keys dropped)", async () => {
    const out = await resolve(
      request({ toolSlug: "demo", options: { extra: true } }),
    );
    expect(out).toMatchObject({ ok: true, req: { options: { quality: 80 } } });
  });

  it("fails the job, not the worker, on a value the schema rejects", async () => {
    const out = await resolve(
      request({ toolSlug: "demo", options: { quality: 500 } }),
    );
    expect(out).toMatchObject({
      ok: false,
      outcome: {
        ok: false,
        error: {
          name: "EngineError",
          code: "internal",
          message: expect.stringMatching(/^invalid options:/),
        },
      },
    });
  });

  it("fails on a slug it has no tool for", async () => {
    const out = await resolve(request({ toolSlug: "nope" }));
    expect(out).toMatchObject({
      ok: false,
      outcome: { error: { message: 'unknown tool "nope"' } },
    });
  });
});
