import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@/lib/registry";
import { makeCaps } from "@/test/caps";
import { NoEngineError, resolvePipeline } from "./router";

type PlainTool = Pick<ToolDefinition, "slug" | "pipeline">;

describe("resolvePipeline", () => {
  it("picks the first eligible candidate and never evaluates later ones", () => {
    const rejected = vi.fn(() => false);
    const accepted = vi.fn(() => true);
    const unreached = vi.fn(() => true);
    const tool: PlainTool = {
      slug: "jpg-to-png",
      pipeline: [
        {
          op: "transcode",
          candidates: [
            { engine: "canvas", when: rejected },
            { engine: "canvas", when: accepted },
            { engine: "canvas", when: unreached },
          ],
        },
      ],
    };

    expect(resolvePipeline(tool, makeCaps())).toEqual([
      { op: "transcode", engine: "canvas" },
    ]);
    expect(rejected).toHaveBeenCalled();
    expect(accepted).toHaveBeenCalled();
    expect(unreached).not.toHaveBeenCalled();
  });

  it("falls through a false predicate to the unconditional fallback candidate", () => {
    const tool: PlainTool = {
      slug: "jpg-to-png",
      pipeline: [
        {
          op: "transcode",
          candidates: [
            { engine: "canvas", when: () => false },
            { engine: "canvas" },
          ],
        },
      ],
    };

    expect(resolvePipeline(tool, makeCaps())).toEqual([
      { op: "transcode", engine: "canvas" },
    ]);
  });

  it("resolves each step of a multi-step pipeline independently, against the same caps", () => {
    const step0When = vi.fn(() => true);
    const step1When = vi.fn(() => false);
    const tool: PlainTool = {
      slug: "video-thing",
      pipeline: [
        {
          op: "transcode",
          candidates: [{ engine: "canvas", when: step0When }],
        },
        {
          op: "compress",
          candidates: [
            { engine: "canvas", when: step1When },
            { engine: "canvas" },
          ],
        },
      ],
    };
    const caps = makeCaps();

    expect(resolvePipeline(tool, caps)).toEqual([
      { op: "transcode", engine: "canvas" },
      { op: "compress", engine: "canvas" },
    ]);
    expect(step0When).toHaveBeenCalledWith(caps);
    expect(step1When).toHaveBeenCalledWith(caps);
  });

  it("throws NoEngineError naming the tool and step when nothing is eligible", () => {
    const tool: PlainTool = {
      slug: "jpg-to-png",
      pipeline: [
        {
          op: "transcode",
          candidates: [{ engine: "canvas", when: () => false }],
        },
      ],
    };

    let error: unknown;
    try {
      resolvePipeline(tool, makeCaps());
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(NoEngineError);
    const noEngineError = error as NoEngineError;
    expect(noEngineError.name).toBe("NoEngineError");
    expect(noEngineError.slug).toBe("jpg-to-png");
    expect(noEngineError.step).toBe(0);
  });

  it("rethrows a throwing predicate wrapped with tool/step/engine context and cause", () => {
    const boom = new Error("boom");
    const tool: PlainTool = {
      slug: "jpg-to-png",
      pipeline: [
        {
          op: "transcode",
          candidates: [
            {
              engine: "canvas",
              when: () => {
                throw boom;
              },
            },
          ],
        },
      ],
    };

    let error: unknown;
    try {
      resolvePipeline(tool, makeCaps());
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      '[tool jpg-to-png] step 0 candidate "canvas" predicate threw',
    );
    expect((error as Error).cause).toBe(boom);
  });
});
