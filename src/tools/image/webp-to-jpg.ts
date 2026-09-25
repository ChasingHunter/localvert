import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * jpg is a lossy, alpha-free target, so this tool exposes both a `quality`
 * knob and a `background` fill for whatever was transparent in the source
 * WebP — `jpgOptions`/`jpgDefaults`, shared with every other `*-to-jpg`
 * tool (see `src/tools/_shared-options.ts`). `background` is read by the
 * canvas engine's jpg encode path (`src/lib/engines/canvas/adapter.ts`) and,
 * since this slice's fix, by `jsquash-jpeg`'s own encode too
 * (`src/lib/engines/jsquash-jpeg/adapter.ts`'s `compositeOverBackground`) —
 * both of this pipeline's candidate encoders now composite onto it.
 */
export default defineTool({
  slug: "webp-to-jpg",
  category: "image",
  title: "WebP to JPG",
  description:
    "Convert WebP to JPG — open WebP images anywhere. Free, private, runs " +
    "in your browser. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["webp"],
  produces: "jpg",

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("webp", "jpg"),

  batch: true,
});
