"use client";

import { useEffect, useState } from "react";
import { computeEstimateText, type ProbeResult } from "@/lib/estimate";
import type { FormatId } from "@/lib/registry/formats";
import type { ToolDefinition } from "@/lib/registry/types";

/**
 * ADR-0017's "Estimates" addendum (2026-09-30): shown next to a file staged
 * for a target-size/percent compress mode (see `ToolRunner`'s
 * `estimateStagedFiles`) instead of the tool submitting on drop. Probes the
 * file exactly once per `file` (off the main thread — invariant 2, via
 * `probeMediaInWorker`/`probePdfInWorker`) and recomputes the estimate text
 * synchronously from the cached probe on every `options` change, so dragging
 * the target/percent slider never re-probes the file.
 *
 * `aria-live="polite"` on the wrapping `<p>` is this slice's accessible
 * hook for the estimate (ADR-0017's "a polite live region or
 * aria-describedby of the target field" — the target/percent fields
 * themselves live in `OptionsForm`, generated generically from the tool's
 * zod schema with no knowledge of this component, so a live region here
 * satisfies the requirement without threading an id across that boundary).
 */
export function SizeEstimate({
  tool,
  file,
  sourceFormat,
  options,
}: {
  tool: ToolDefinition;
  file: File;
  sourceFormat: FormatId;
  options: Readonly<Record<string, unknown>>;
}) {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [failed, setFailed] = useState(false);

  // Deliberately scoped to `[tool, file]`, not `options` — re-probing on
  // every options edit would defeat the point (see doc comment above);
  // `options` is only read below, outside this effect, to compute the text
  // from the already-cached probe.
  useEffect(() => {
    let cancelled = false;
    setProbe(null);
    setFailed(false);

    async function run() {
      const { probeMediaInWorker, probePdfInWorker } = await import(
        "@/lib/workers/spawn"
      );
      if (tool.estimateKind === "pdf") {
        const bytes = await file.arrayBuffer();
        return probePdfInWorker(bytes);
      }
      return probeMediaInWorker(file);
    }

    run().then(
      (result) => {
        if (!cancelled) setProbe(result);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tool, file]);

  let text: string;
  if (failed) {
    text = "Couldn't estimate the result size.";
  } else if (!probe) {
    text = "Estimating…";
  } else {
    text =
      computeEstimateText(tool, options, probe, file.size, sourceFormat) ?? "";
  }

  if (!text) return null;

  return (
    <p aria-live="polite" className="text-sm text-ink-muted">
      {text}
    </p>
  );
}
