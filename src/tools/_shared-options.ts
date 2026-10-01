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

/** Just the quality knob. For JPG tools whose source can never be
 * transparent (JPG, HEIC, camera RAW): the background fill would do nothing,
 * so it isn't offered. The encoder falls back to white if it is absent. */
export const jpgQualityOptions = z.object({
  quality: z
    .number()
    .min(0.1)
    .max(1)
    .meta({ label: "Quality", control: "slider", step: 0.01 })
    .default(0.85),
});
export const jpgQualityDefaults: z.infer<typeof jpgQualityOptions> = {
  quality: 0.85,
};

/** Quality plus the fill for transparent areas: for sources that can carry
 * alpha (PNG, WebP, GIF, AVIF, SVG, TIFF, ...). */
export const jpgOptions = jpgQualityOptions.extend({
  background: z
    .string()
    .meta({
      label: "Background for transparent areas",
      control: "text",
      help: "JPG has no transparency, so this colour fills any transparent pixels before encoding.",
    })
    .default("#ffffff"),
});
export const jpgDefaults: z.infer<typeof jpgOptions> = {
  ...jpgQualityDefaults,
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

/** BMP is lossless (no quality knob) and its bit depth (24 vs 32-bit) is
 * decided automatically by whether the source has transparency — see
 * `canvas/bmp.ts`'s `encodeBmp` — so there's nothing left to expose here. */
export const bmpOptions = z.object({});
export const bmpDefaults: z.infer<typeof bmpOptions> = {};

/** Single-frame GIF output — `canvas/gif.ts`'s `encodeGif` always quantizes
 * to 256 colors with 1-bit transparency, gifenc's own fixed defaults, so
 * there's no user-facing knob for it either. */
export const gifOptions = z.object({});
export const gifDefaults: z.infer<typeof gifOptions> = {};

/**
 * Shared by every `*-to-ico` tool — which sizes `canvas/ico.ts`'s
 * `icoSizesForPreset` writes into the icon. A non-square source is fit
 * inside each size's square with transparent padding (`runEncodeIco`'s doc
 * comment), never cropped or stretched.
 */
export const icoOptions = z.object({
  sizes: z
    .enum(["favicon", "app", "single"])
    .meta({
      label: "Sizes",
      control: "select",
      optionLabels: {
        favicon: "Favicon (16, 32, 48 px)",
        app: "App icon (up to 256 px)",
        single: "Single 256 px",
      },
      help:
        '"Favicon" (16/32/48px) covers browser tabs and bookmarks. "App" ' +
        "adds the larger sizes (64–256px) desktop/taskbar icons use. " +
        '"Single" writes just one 256px entry.',
    })
    .default("favicon"),
});
export const icoDefaults: z.infer<typeof icoOptions> = { sizes: "favicon" };

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
    .meta({
      label: "Detail",
      control: "select",
      optionLabels: { low: "Low", medium: "Medium", high: "High" },
    })
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
/**
 * Shared by every audio tool on the `mediabunny` engine (Phase 3b). `select`
 * controls only render `z.enum` string values (see `describeField` in
 * `src/lib/options/fields.ts`), hence string literals — `mediabunny`
 * adapter's `audio.ts` (`bitrateOf`/`sampleRateOf`/`numberOfChannelsOf`)
 * parses them back to the numbers/`undefined` its `Conversion.init` audio
 * options actually want. "keep" means "pass the source's own value through
 * unchanged", the same convention as `svgOptions.detail` reads for its own
 * select fields.
 */
export const audioBitrateSelect = z
  .enum(["96", "128", "192", "256", "320"])
  .meta({
    label: "Bitrate",
    control: "select",
    optionLabels: {
      "96": "96 kbps",
      "128": "128 kbps",
      "192": "192 kbps",
      "256": "256 kbps",
      "320": "320 kbps",
    },
  })
  .default("192");

/** Sample rate and channels are only offered on `compress-audio` (where
 * mono is a real size lever). Plain format converters don't expose them, so
 * both stay unset and the adapter keeps the source's own values
 * (`sampleRateOf`/`numberOfChannelsOf` treat an absent value as "keep"). */
export const audioSampleRateSelect = z
  .enum(["keep", "44100", "48000"])
  .meta({
    label: "Sample rate",
    control: "select",
    optionLabels: {
      keep: "Keep original",
      "44100": "44.1 kHz",
      "48000": "48 kHz",
    },
  })
  .default("keep");

export const audioChannelsSelect = z
  .enum(["keep", "mono", "stereo"])
  .meta({
    label: "Channels",
    control: "select",
    optionLabels: {
      keep: "Keep original",
      mono: "Mono",
      stereo: "Stereo",
    },
  })
  .default("keep");

/** For a tool whose output codec is lossy (mp3, m4a/AAC, ogg/opus) — bitrate
 * is the one real knob there. */
export const lossyAudioOptions = z.object({
  bitrate: audioBitrateSelect,
});
export const lossyAudioDefaults: z.infer<typeof lossyAudioOptions> = {
  bitrate: "192",
};

/** For a tool whose output codec is lossless (wav/PCM, flac) — no bitrate
 * knob and nothing else worth exposing, so the form is empty. */
export const losslessAudioOptions = z.object({});
export const losslessAudioDefaults: z.infer<typeof losslessAudioOptions> = {};

/**
 * Shared by every tool that reads a CSV file (`csv-to-json`, `csv-to-xlsx`)
 * — see `src/lib/engines/data/transforms.ts`'s `csvToJson` for what each
 * option actually does. `delimiter`'s enum values double as their own
 * select-option labels (`describeFields`'s "select" case, `src/lib/options/
 * fields.ts` — a zod enum has no separate label slot), so this uses words
 * rather than the literal `,`/`;`/`\t` characters; each data adapter's
 * `delimiterOption` maps a value back to the real delimiter character
 * papaparse expects, `"auto"` passed straight through for it to sniff.
 */
export const csvInputOptions = z.object({
  delimiter: z
    .enum(["auto", "comma", "semicolon", "tab"])
    .meta({
      label: "Delimiter",
      control: "select",
      optionLabels: {
        auto: "Detect automatically",
        comma: "Comma",
        semicolon: "Semicolon",
        tab: "Tab",
      },
    })
    .default("auto"),
  dynamicTyping: z.boolean().meta({
    label: "Detect numbers and booleans",
    control: "switch",
    help:
      'Off keeps every cell a string. On, a cell like "42" or "true" ' +
      "becomes a real number or boolean.",
  }),
});
export const csvInputDefaults: z.infer<typeof csvInputOptions> = {
  delimiter: "auto",
  dynamicTyping: true,
};

/**
 * Shared by `images-to-pdf` and its per-format siblings `jpg-to-pdf`/
 * `png-to-pdf` (ADR-0008 many-to-one `merge` op, `pdf-lib` engine's
 * `runMergeImages`) -- one image per page, `pageSize`/`orientation`/`margin`
 * control how each image is laid out. See `runMergeImages`'s own doc comment
 * for exactly what each value does.
 */
export const imagesToPdfOptions = z.object({
  pageSize: z.enum(["fit", "a4", "letter"]).meta({
    label: "Page size",
    control: "select",
    optionLabels: { fit: "Fit to image", a4: "A4", letter: "Letter" },
  }),
  orientation: z.enum(["auto", "portrait", "landscape"]).meta({
    label: "Orientation",
    control: "select",
    optionLabels: {
      auto: "Match the image",
      portrait: "Portrait",
      landscape: "Landscape",
    },
    showWhen: { field: "pageSize", equals: ["a4", "letter"] },
  }),
  margin: z
    .number()
    .min(0)
    .max(144)
    .meta({
      label: "Margin",
      control: "number",
      unit: "pt",
      showWhen: { field: "pageSize", equals: ["a4", "letter"] },
    }),
});
export const imagesToPdfDefaults: z.infer<typeof imagesToPdfOptions> = {
  pageSize: "fit",
  orientation: "auto",
  margin: 0,
};

export const cropField = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .meta({ label: "Crop", control: "crop" })
  .optional();

/** Page resolution + JPG quality for the two-step "office file to JPG" tools
 * (`word-to-jpg` and siblings): LibreOffice makes a PDF, then `pdfjs` renders
 * it with these. Same fields and ranges as `pdf-to-jpg`; no `pages` field,
 * since a page range on an intermediate PDF the user never sees is confusing. */
export const pageJpgOptions = z.object({
  dpi: z
    .number()
    .int()
    .min(72)
    .max(300)
    .meta({ label: "Resolution", control: "slider", unit: "dpi", step: 1 })
    .default(150),
  quality: jpgQualityOptions.shape.quality,
});
export const pageJpgDefaults: z.infer<typeof pageJpgOptions> = {
  dpi: 150,
  quality: 0.85,
};
