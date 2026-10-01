"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { classifyFiles } from "@/components/dropzone-logic";
import { HOME_HANDOFF_KEY, setPendingFiles } from "@/lib/converter/handoff";
import { describeOpening, routeForFormats } from "@/lib/pwa/open-routing";
import { FORMATS, type FormatId } from "@/lib/registry/formats";

/** The File Handling API's launch queue; not in lib.dom yet. */
interface LaunchParams {
  files: readonly { getFile(): Promise<File> }[];
}
declare global {
  interface Window {
    launchQueue?: {
      setConsumer(consumer: (params: LaunchParams) => void): void;
    };
  }
}

const ALL_FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

/** How long to wait for the OS to hand us files before showing the fallback. */
const LAUNCH_WAIT_MS = 1500;

type Status =
  | { kind: "waiting" }
  | { kind: "opening"; count: number }
  | { kind: "empty" }
  | { kind: "unreadable" };

const CHIP_LINK =
  "inline-flex w-fit min-h-11 items-center rounded-full bg-accent px-5 py-2 text-sm font-medium text-canvas outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/**
 * ADR-0018: receives files the OS opened with the installed app
 * (`launchQueue`, Chromium desktop) and hands them to the converter through
 * the existing in-memory handoff store (ADR-0015). Everything stays in this
 * tab; nothing is read except through the File handles the OS gave us.
 */
export function OpenFiles() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "waiting" });

  useEffect(() => {
    let done = false;

    async function handOff(files: File[]) {
      if (done) return;
      done = true;
      if (files.length === 0) {
        setStatus({ kind: "empty" });
        return;
      }
      setStatus({ kind: "opening", count: files.length });
      const { accepted } = await classifyFiles(files, ALL_FORMAT_IDS);
      if (accepted.length === 0) {
        setStatus({ kind: "unreadable" });
        return;
      }
      const route = routeForFormats(accepted.map((a) => a.format));
      const staged = accepted.map((a) => a.file);
      if (route.kind === "tool") {
        setPendingFiles(route.slug, staged);
        router.replace(`/tools/${route.slug}`);
      } else {
        setPendingFiles(HOME_HANDOFF_KEY, staged);
        router.replace("/");
      }
    }

    const queue = window.launchQueue;
    if (!queue) {
      setStatus({ kind: "empty" });
      return;
    }
    queue.setConsumer(async (params) => {
      const files = await Promise.all(params.files.map((h) => h.getFile()));
      void handOff(files);
    });
    const timer = window.setTimeout(() => {
      if (!done) setStatus({ kind: "empty" });
    }, LAUNCH_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {status.kind === "opening" ? describeOpening(status.count) : ""}
      </p>
      {status.kind === "waiting" || status.kind === "opening" ? (
        <p className="text-lg text-ink-muted" aria-hidden="true">
          {status.kind === "opening"
            ? describeOpening(status.count)
            : "Opening…"}
        </p>
      ) : (
        <>
          <h1 className="font-display text-3xl font-medium text-ink">
            {status.kind === "unreadable"
              ? "Localvert can't open those files"
              : "Nothing to open"}
          </h1>
          <p className="text-lg text-ink-muted">
            {status.kind === "unreadable"
              ? "None of them is a format Localvert recognizes. You can still drop files on the home page."
              : "Open a file with Localvert from your files app, or drop one on the home page."}
          </p>
          <Link href="/" className={CHIP_LINK}>
            Go to the home page
          </Link>
        </>
      )}
    </>
  );
}
