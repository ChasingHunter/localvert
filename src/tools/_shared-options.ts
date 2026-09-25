import { z } from "zod";

/**
 * Option schemas shared by every image tool that targets a given output
 * format, so `jpg-to-webp`, `png-to-webp`, and any future `*-to-webp` tool
 * all render an identical options form instead of drifting apart one tool
 * file at a time. Grouped by output format, since that's what determines
 * which engine option names apply (see each jsquash adapter's `runEncode`).
 *
 * Deliberately a flat file directly under `src/tools/`, not
 * `src/tools/_shared/options.ts` and not `src/tools/<category>/...`:
 * `scanTools` (scripts/gen-registry.ts) walks every *directory* under
 * `src/tools/` as if it were a tool category and imports every `.ts` file
 * inside as a tool module's default export. A `_shared/` subdirectory would
 * be scanned exactly like `image/` or `pdf/` and `pnpm gen` would emit
 * `import _sharedOptions from "@/tools/_shared/options"` into the generated
 * `TOOLS` barrel — which has no default export, so this would fail
 * typecheck immediately. A file directly in `src/tools/` (a sibling of the
 * category directories, not inside one) is invisible to `scanTools`, which
 * only lists directories at that level and then only reads files one level
 * inside each of *those* — never files sitting in `src/tools/` itself.
 */

export const jpgOptions = z.object({
  quality: z
    .number()
    .min(0.1)
    .max(1)
    .meta({ label: "Quality", control: "slider", step: 0.01 })
    .default(0.85),
  background: z
    .string()
    .meta({
      label: "Background for transparent areas",
      control: "text",
      help: "JPG has no transparency — this color fills any transparent pixels before encoding.",
    })
    .default("#ffffff"),
});
export const jpgDefaults: z.infer<typeof jpgOptions> = {
  quality: 0.85,
  background: "#ffffff",
};

export const webpOptions = z.object({
  quality: z
    .number()
    .min(0)
    .max(1)
    .meta({ label: "Quality", control: "slider", step: 0.01 }),
  lossless: z.boolean().meta({ label: "Lossless", control: "switch" }),
});
export const webpDefaults: z.infer<typeof webpOptions> = {
  quality: 0.85,
  lossless: false,
};

export const avifOptions = z.object({
  quality: z
    .number()
    .min(0)
    .max(1)
    .meta({ label: "Quality", control: "slider", step: 0.01 }),
  speed: z.number().int().min(0).max(10).meta({
    label: "Speed",
    control: "number",
    help: "Lower is smaller and slower.",
  }),
});
export const avifDefaults: z.infer<typeof avifOptions> = {
  quality: 0.6,
  speed: 6,
};

export const jxlOptions = z.object({
  quality: z
    .number()
    .min(0)
    .max(1)
    .meta({ label: "Quality", control: "slider", step: 0.01 }),
  effort: z
    .number()
    .int()
    .min(1)
    .max(9)
    .meta({ label: "Effort", control: "number" }),
  lossless: z.boolean().meta({ label: "Lossless", control: "switch" }),
});
export const jxlDefaults: z.infer<typeof jxlOptions> = {
  quality: 0.85,
  effort: 7,
  lossless: false,
};

/** PNG is lossless — no encode knob to expose, same reasoning as jpg-to-png. */
export const pngOptions = z.object({});
export const pngDefaults: z.infer<typeof pngOptions> = {};

/**
 * Shared by every `*-to-svg` tool — tracing options for the `tracer` engine
 * (`src/lib/engines/tracer/adapter.ts`), not pixel-encode options like the
 * groups above. `colors`/`detail` map to the library's own knobs there; see
 * that adapter's doc comments for the exact mapping. `maxSize` caps the long
 * side a raster is traced at — tracing cost grows fast with pixel count.
 */
export const svgOptions = z.object({
  colors: z
    .number()
    .int()
    .min(2)
    .max(64)
    .meta({ label: "Colours", control: "slider", step: 1 })
    .default(16),
  detail: z
    .enum(["low", "medium", "high"])
    .meta({ label: "Detail", control: "select" })
    .default("medium"),
  maxSize: z
    .number()
    .int()
    .min(256)
    .max(4096)
    .meta({
      label: "Max size for tracing",
      control: "number",
      unit: "px",
      help: "Large images are traced at up to this size on the long side, to keep tracing fast. The output is a vector, so it still scales to any display size.",
    })
    .default(1600),
});
export const svgDefaults: z.infer<typeof svgOptions> = {
  colors: 16,
  detail: "medium",
  maxSize: 1600,
};

/**
 * The crop rectangle shared by every `crop-*.ts` tool — source-pixel
 * coordinates (the dropped image's own `naturalWidth`/`naturalHeight`, not
 * the on-screen display size), clamped by the `canvas` engine's `runCrop`
 * (`src/lib/engines/canvas/adapter.ts`). Optional: absent means "pass
 * through unchanged", same as the engine's own fallback when it's missing.
 * `CropEditor` (`src/components/crop-editor.tsx`) is the only thing that
 * ever sets it — `OptionsForm` filters "crop" controls out of the generic
 * form (`src/components/options-form.tsx`), since no sensible x/y/width/
 * height control exists without the dropped image's own dimensions.
 */
export const cropField = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .meta({ label: "Crop", control: "crop" })
  .optional();
