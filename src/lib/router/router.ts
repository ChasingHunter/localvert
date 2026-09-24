import type {
  Capabilities,
  EngineId,
  Operation,
  ToolDefinition,
} from "@/lib/registry";

/** One pipeline step, resolved to the single engine the router chose for it. */
export interface ResolvedStep {
  op: Operation;
  engine: EngineId;
}

/**
 * Thrown when a pipeline step has no eligible candidate for the given
 * capabilities. `defineTool` requires every step's last candidate to be
 * unconditional, so a tool that passed that check can never actually hit
 * this — but the router resolves plain data, not only `defineTool`-checked
 * data, and must stay total rather than assume the invariant held upstream.
 */
export class NoEngineError extends Error {
  readonly slug: string;
  readonly step: number;

  constructor(slug: string, step: number) {
    super(`[tool ${slug}] step ${step} has no eligible engine candidate`);
    this.name = "NoEngineError";
    this.slug = slug;
    this.step = step;
  }
}

/**
 * Resolves a tool's declared pipeline against a browser's actual
 * capabilities: one engine per step, the first candidate with no `when`
 * guard, or the first whose `when(caps)` returns true. A tool declares
 * preference, in order; this resolves it to what the browser can run.
 *
 * A `when` predicate that throws is a bug in that predicate, not a reason to
 * quietly fall through to the next candidate — swallowing it would run a
 * different engine than the one that failed, with no record of why. It is
 * rethrown instead, wrapped with which tool/step/engine failed and the
 * original error attached as `cause`.
 */
export function resolvePipeline(
  tool: Pick<ToolDefinition, "slug" | "pipeline">,
  caps: Capabilities,
): ResolvedStep[] {
  return tool.pipeline.map((step, i) => {
    for (const candidate of step.candidates) {
      if (!candidate.when) {
        return { op: step.op, engine: candidate.engine };
      }

      let eligible: boolean;
      try {
        eligible = candidate.when(caps);
      } catch (cause) {
        throw new Error(
          `[tool ${tool.slug}] step ${i} candidate "${candidate.engine}" ` +
            "predicate threw",
          { cause },
        );
      }
      if (eligible) {
        return { op: step.op, engine: candidate.engine };
      }
    }
    throw new NoEngineError(tool.slug, i);
  });
}
