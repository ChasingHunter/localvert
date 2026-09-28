import { defineTool, imagePipeline } from "@/lib/registry";
import { icoDefaults, icoOptions } from "../_shared-options";

/**
 * A non-square source is fit inside each requested size's square with
 * transparent padding, not cropped or stretched — see `canvas/adapter.ts`'s
 * `runEncodeIco` doc comment.
 */
export default defineTool({
  slug: "png-to-ico",
  category: "image",
  title: "PNG to ICO",
  description:
    "Convert PNG to a Windows icon (.ico), writing every size the chosen preset needs into one file.",

  accepts: ["png"],
  produces: "ico",

  options: icoOptions,
  defaults: icoDefaults,

  pipeline: imagePipeline("png", "ico"),

  batch: true,
});
