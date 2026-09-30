import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Static export, same as sitemap.ts — no server to render this on request.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
