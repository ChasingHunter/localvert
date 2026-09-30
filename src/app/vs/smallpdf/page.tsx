import type { Metadata } from "next";
import { VsPage } from "@/components/vs-page";
import { openGraph } from "@/lib/site";

export const metadata: Metadata = {
  title: "Localvert vs Smallpdf",
  description:
    "How Localvert compares to Smallpdf: what it does well, and the one thing that's different, files stay on your device instead of being uploaded.",
  alternates: { canonical: "/vs/smallpdf" },
  openGraph: openGraph("/vs/smallpdf"),
};

export default function VsSmallpdfPage() {
  return (
    <VsPage
      name="Smallpdf"
      lastChecked="28 September 2026"
      intro="Smallpdf is one of the biggest names in online PDF tools. Here's what it does well, and the one difference that matters most."
      doesWell={[
        "A simple, polished PDF suite with a freemium model, and one of the top competitors to iLovePDF by traffic.",
        "Strong organic search presence: about 64% of its desktop traffic comes from search rather than ads or direct visits, a sign people find its tool pages when they search for a specific task.",
      ]}
      coreDifference="Smallpdf processes your file by uploading it to their server. Localvert converts, edits and compresses PDFs in your own browser, so the file never leaves your device."
      whenToPreferThem={[
        "You want a well-known, established brand with a free tier plus a paid plan for heavier use.",
        "You're fine with uploading your files and prefer Smallpdf's specific tools or account features.",
      ]}
      sources={[
        {
          label: "Similarweb: smallpdf.com",
          href: "https://www.similarweb.com/website/smallpdf.com/",
        },
        {
          label: "Similarweb: ilovepdf.com (competitor context)",
          href: "https://www.similarweb.com/website/ilovepdf.com/",
        },
      ]}
    />
  );
}
