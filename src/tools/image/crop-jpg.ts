import { defineTool, imagePipeline } from "@/lib/registry";
import { cropField, jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("jpg", "jpg", ["crop"])` — decode -> crop ->
 * encode (ADR-0007), the same three-step shape as `rotate-jpg.ts`. The
 * `crop` transform only has one candidate engine (`canvas` —
 * `TRANSFORM_PREFERENCE.crop` in `image-pipeline.ts`), so this always
 * resolves to `canvas` for that step regardless of which codec handles
 * decode/encode. `jpgOptions`/`jpgDefaults` (`quality`/`background`) are
 * shared with every other `*-to-jpg`/`*-jpg` tool — see
 * `src/tools/_shared-options.ts`, which is also where `cropField` (the
 * crop rectangle itself) lives, shared with `crop-png`/`crop-webp`.
 *
 * `batch: false`: a crop is chosen against one specific image in
 * `CropEditor` (`src/components/tool-runner.tsx`'s `hasCropField` branch),
 * so there is no meaningful "same crop for every file in a batch" here —
 * unlike `rotate`/`resize`, which apply identically to every dropped file.
 */
export default defineTool({
  slug: "crop-jpg",
  category: "image",
  title: "Crop JPG",
  description:
    "Crop a JPG to an exact rectangle, free-form or a fixed aspect ratio " +
    "(1:1, 4:3, 16:9, 3:2) — free, private, in your browser. Files never " +
    "leave your device. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["jpg"],
  produces: "jpg",

  options: jpgOptions.extend({ crop: cropField }),
  defaults: jpgDefaults,

  pipeline: imagePipeline("jpg", "jpg", ["crop"]),

  batch: false,
});
