import { buildLlmsTxt } from "@/lib/seo/llms-txt";
import { TOOLS } from "@/tools";

// Static export, same as robots.ts and sitemap.ts: emitted once at build time.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsTxt(TOOLS), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
