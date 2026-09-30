import type { Metadata } from "next";
import { VsPage } from "@/components/vs-page";
import { openGraph } from "@/lib/site";

export const metadata: Metadata = {
  title: "Localvert vs VERT",
  description:
    "How Localvert compares to VERT: what it does well, and the one thing that's different, video stays on your device too instead of going to a server.",
  alternates: { canonical: "/vs/vert" },
  openGraph: openGraph("/vs/vert"),
};

export default function VsVertPage() {
  return (
    <VsPage
      name="VERT"
      lastChecked="28 September 2026"
      intro="VERT is an open-source general file converter and a well-liked privacy-focused alternative to upload-based converters. Here's what it does well, and the one difference that matters most."
      doesWell={[
        "A very wide format catalog, over 250 formats, and an active open-source project with about 15.7k GitHub stars and a fair amount of press coverage.",
        "Converts most file types locally in your browser, the same privacy promise Localvert makes for its own catalog.",
      ]}
      coreDifference={
        <>
          VERT's own privacy page describes itself as "fully local*", and that
          asterisk is the difference: VERT sends video files to their server to
          convert, and it has no PDF tools (merge, split, edit) at all.
          Localvert converts video locally too, and covers PDF, image, audio and
          document tools in the same place.
        </>
      }
      whenToPreferThem={[
        "You need one of the 250+ formats VERT supports that Localvert doesn't cover yet.",
        "You don't mind video going to a server, or you're not converting video at all, and you just want VERT's broader non-PDF format list.",
      ]}
      sources={[
        { label: "vert.sh", href: "https://vert.sh/" },
        { label: "VERT: Privacy", href: "https://vert.sh/privacy/" },
        {
          label: "GitHub: VERT-sh/vert",
          href: "https://github.com/VERT-sh/vert",
        },
      ]}
    />
  );
}
