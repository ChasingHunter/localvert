import type { MetadataRoute } from "next";
import {
  fileHandlerAccept,
  shareTargetAccept,
} from "@/lib/pwa/file-handler-accept";
import { SHARE_TARGET_PATH } from "@/lib/pwa/share-stash";

// `output: "export"` has no server to answer /manifest.webmanifest, so it
// is emitted at build time like every other route (invariant 4).
export const dynamic = "force-static";

// Same values as `--color-canvas` / the light `themeColor` in layout.tsx.
// A manifest can't read CSS tokens, so they're repeated here once.
const CANVAS = "#f7f6f2";

/**
 * ADR-0018: the installable app. `file_handlers` registers Localvert with the
 * OS for every format some tool accepts (Chromium desktop), and
 * `share_target` puts it in the Android share sheet. Both lists come from the
 * generated catalog via `fileHandlerAccept`, so they track the registry.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Localvert",
    short_name: "Localvert",
    description:
      "Convert images, video, audio, PDFs and documents on your own device. Nothing is uploaded.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: CANVAS,
    theme_color: CANVAS,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Next's manifest types are too narrow here: no `launch_type`, and
    // `share_target.params.files` is typed as a DOM `File`, not `{name, accept}`.
    ...({
      file_handlers: [
        {
          action: "/open",
          accept: fileHandlerAccept(),
          launch_type: "single-client",
        },
      ],
      share_target: {
        action: SHARE_TARGET_PATH,
        method: "POST",
        enctype: "multipart/form-data",
        params: {
          files: [{ name: "files", accept: shareTargetAccept() }],
        },
      },
    } as object),
  };
}
