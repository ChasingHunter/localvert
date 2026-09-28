import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/** Same first-frame-only caveat as `gif-to-png` — see that tool's doc
 * comment. */
export default defineTool({
  slug: "gif-to-jpg",
  category: "image",
  title: "GIF to JPG",
  description:
    "Convert GIF to JPG. An animated GIF becomes a still image of its first frame; transparent areas are filled with a background color.",

  accepts: ["gif"],
  produces: "jpg",

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("gif", "jpg"),

  batch: true,
});
