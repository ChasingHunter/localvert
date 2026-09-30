import type { Metadata } from "next";
import { VsPage } from "@/components/vs-page";
import { openGraph } from "@/lib/site";

export const metadata: Metadata = {
  title: "Localvert vs iLovePDF",
  description:
    "How Localvert compares to iLovePDF: what it does well, and the one thing that's different, files stay on your device instead of being uploaded.",
  alternates: { canonical: "/vs/ilovepdf" },
  openGraph: openGraph("/vs/ilovepdf"),
};

export default function VsIlovePdfPage() {
  return (
    <VsPage
      name="iLovePDF"
      lastChecked="28 September 2026"
      intro="iLovePDF is a large, well-established PDF toolkit. Here's what it does well, and the one difference that matters most."
      doesWell={[
        "A big PDF-only catalog with a clean, focused set of tools, plus sister products for images (iLoveIMG), e-signing (iLoveSign) and an API (iLoveAPI) once you need more than PDF.",
        "A long track record: it has been running since 2010 and is among the most visited PDF sites online (about 220 million visits a month, by Similarweb's estimate).",
      ]}
      coreDifference="iLovePDF processes your file by uploading it to their server. Localvert converts, edits and compresses PDFs in your own browser, so the file never leaves your device."
      whenToPreferThem={[
        "You want image editing, e-signing and PDF tools bundled under one account across iLovePDF's sister products.",
        "You're fine with uploading your files and want an established service that has been around for over a decade.",
      ]}
      sources={[
        { label: "ilovepdf.com", href: "https://www.ilovepdf.com/" },
        {
          label: "iLovePDF: About",
          href: "https://www.ilovepdf.com/help/about",
        },
        {
          label: "Similarweb: ilovepdf.com",
          href: "https://www.similarweb.com/website/ilovepdf.com/",
        },
        {
          label: "Semrush: ilovepdf.com overview",
          href: "https://www.semrush.com/website/ilovepdf.com/overview/",
        },
      ]}
    />
  );
}
