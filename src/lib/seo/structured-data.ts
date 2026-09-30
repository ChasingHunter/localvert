import { CATEGORY_META } from "@/lib/registry/categories";
import type { ToolDefinition } from "@/lib/registry/types";
import { SITE_URL } from "@/lib/site";
import type { FaqItem } from "./tool-faq";

type JsonLdTool = Pick<
  ToolDefinition,
  "slug" | "title" | "description" | "category"
>;

export interface BreadcrumbEntry {
  label: string;
  href: string;
}

/** Home > category > tool. Drives both the visible breadcrumb and the JSON-LD. */
export function toolBreadcrumb(tool: JsonLdTool): BreadcrumbEntry[] {
  return [
    { label: "Home", href: "/" },
    { label: CATEGORY_META[tool.category].label, href: `/${tool.category}` },
    { label: tool.title, href: `/tools/${tool.slug}` },
  ];
}

/** The `@graph` for a tool page: WebApplication, BreadcrumbList and FAQPage. */
export function toolJsonLd(tool: JsonLdTool, faq: readonly FaqItem[]) {
  const url = `${SITE_URL}/tools/${tool.slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: tool.title,
        url,
        description: tool.description,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires a modern browser with WebAssembly",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        isAccessibleForFree: true,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: toolBreadcrumb(tool).map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: entry.label,
          item: `${SITE_URL}${entry.href}`,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };
}

/** The home page's `WebSite` node. No SearchAction: search is a client modal with no URL. */
export function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Localvert",
    url: `${SITE_URL}/`,
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so the data can't close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, String.raw`\u003c`);
}
