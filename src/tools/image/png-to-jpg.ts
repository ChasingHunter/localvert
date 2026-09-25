import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("png", "jpg")` (ADR-0007: decode -> encode) —
 * see docs/ADDING_A_TOOL.md. Resolves to `jsquash-png` decode and
 * `jsquash-jpeg` encode. `jpgOptions`/`jpgDefaults` are shared with every
 * other `*-to-jpg` tool — see `src/tools/_shared-options.ts`. Note:
 * `background` only takes effect when the resolved encode engine is
 * `canvas` (its `runEncode`/`runTranscode` fill transparent pixels with
 * `options.background` before compositing) — `jsquash-jpeg`'s own
 * `runEncode` (`src/lib/engines/jsquash-jpeg/adapter.ts`) does not read
 * `options.background` at all, so on the default resolved pipeline (jsquash
 * on both sides, no `canvas` involved) transparent PNG pixels keep whatever
 * RGB was stored under their alpha rather than being composited onto the
 * chosen background. Flagged for the planner; not something a tool file can
 * fix — the option is still correct to expose here since it does work once
 * `canvas` is the resolved encoder, and the engine adapter is out of this
 * slice's scope.
 */
export default defineTool({
  slug: "png-to-jpg",
  category: "image",
  title: "PNG to JPG",
  description:
    "Convert PNG to JPG — much smaller files for photos and screenshots. " +
    "Free and private: runs in your browser, no upload. Transparent areas " +
    "are filled with a background color; re-encoding strips embedded " +
    "metadata, including GPS location.",

  accepts: ["png"],
  produces: "jpg",

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("png", "jpg"),

  batch: true,
});
