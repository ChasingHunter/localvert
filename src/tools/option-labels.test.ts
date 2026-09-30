import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOLS } from "./index";

/**
 * Tool files still being labelled in a parallel slice (resize, trim,
 * video-to-gif, compress-pdf). Labelled in the parallel slice: the planner
 * removes this list after the merge.
 */
const LABELLED_IN_PARALLEL_SLICE = new Set<string>([
  "resize-image-jpg",
  "resize-image-png",
  "resize-image-webp",
  "trim-video",
  "video-to-gif",
  "compress-pdf",
]);

type Core = z.core.$ZodType;

function unwrap(field: Core): Core {
  const def = field._zod.def as { type: string; innerType?: Core };
  return (def.type === "optional" || def.type === "default") && def.innerType
    ? unwrap(def.innerType)
    : field;
}

describe("option labels", () => {
  it("every select-rendered enum value has an optionLabels entry", () => {
    const missing: string[] = [];
    for (const tool of TOOLS) {
      if (LABELLED_IN_PARALLEL_SLICE.has(tool.slug)) continue;
      for (const [key, raw] of Object.entries(tool.options.shape)) {
        const field = unwrap(raw as Core);
        const meta = z.globalRegistry.get(field);
        if (meta?.control !== "select") continue;
        const { entries } = field._zod.def as unknown as {
          entries: Record<string, string>;
        };
        for (const value of Object.values(entries)) {
          if (!meta.optionLabels?.[value]) {
            missing.push(`${tool.slug}.${key}=${value}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("no option label or help text carries an em dash", () => {
    const bad: string[] = [];
    for (const tool of TOOLS) {
      for (const [key, raw] of Object.entries(tool.options.shape)) {
        const meta = z.globalRegistry.get(unwrap(raw as Core));
        const texts = [
          meta?.label,
          meta?.help,
          ...Object.values(meta?.optionLabels ?? {}),
        ];
        if (texts.some((t) => t?.includes("—"))) {
          bad.push(`${tool.slug}.${key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
