"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { Dropzone } from "@/components/dropzone";
import type { AcceptedFile, RejectedFile } from "@/components/dropzone-logic";
import { JobList } from "@/components/job-list";
import { OptionsForm } from "@/components/options-form";
import { getAppJobEngine, jobStore, selectOrderedJobs } from "@/lib/jobs";
import {
  FORMATS,
  formatFromFilename,
  type ToolDefinition,
} from "@/lib/registry";
import { collectToBlob } from "@/lib/sinks";
import { TOOL_LOADERS } from "@/tools/loaders";

/**
 * zod normally JIT-compiles fast validators via a `new Function(...)` probe,
 * wrapped in try/catch so it degrades gracefully where that's unavailable.
 * Under this app's CSP (`script-src` carries no `'unsafe-eval'` — invariant
 * 1, never widened) the browser still reports a CSP violation for the probe
 * itself, even though the catch swallows the resulting error. `jitless`
 * skips the probe and runs zod's (still fully correct, just interpreted)
 * validator path instead — zod's own sanctioned escape hatch for exactly
 * this case. Set once here, at this module's top level, since this is the
 * first client code to touch a tool's zod schema (`TOOL_LOADERS[slug]()`
 * below runs the tool file's module-level `defineTool(...)`, which parses
 * its `defaults` against `options`). Belongs on every page once one exists
 * with a client-side bootstrap module to own app-wide setup like this —
 * layout.tsx doesn't have one yet.
 */
z.config({ jitless: true });

interface ToolRunnerProps {
  slug: string;
}

/** The extension a filename claims, without its dot — "" if it has none. */
function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

/**
 * A human reason a dropped file wasn't accepted. Content decides, never the
 * name — `classifyFiles` already sniffed `detected` from the file's magic
 * bytes, so this only turns that verdict into a sentence.
 */
function rejectionMessage(r: RejectedFile): string {
  if (r.reason === "unknown-format" || !r.detected) {
    return "Unrecognized file format.";
  }
  const detectedLabel = FORMATS[r.detected].label;
  const namedFormat = formatFromFilename(r.file.name);
  if (namedFormat !== null && namedFormat !== r.detected) {
    return `Detected as ${detectedLabel} though named .${extOf(r.file.name)}.`;
  }
  return `Detected as ${detectedLabel}, which this tool doesn't accept.`;
}

/**
 * CLIENT COMPONENT. Loads exactly one tool via `TOOL_LOADERS[slug]` — never
 * the `TOOLS` barrel, which would pull every tool's pipeline into this page's
 * bundle (see docs/ADDING_A_TOOL.md and invariant 3, no engine in the core
 * bundle: a tool's option schema and defaults are small, but the barrel
 * still imports every other tool file alongside it).
 *
 * Owns: the dropzone, the options form (hidden when the tool has no
 * options), and the job list for this tool. Submission happens immediately
 * on drop, using whatever options are set at that moment — there is no
 * separate "convert" button.
 */
export function ToolRunner({ slug }: ToolRunnerProps) {
  const [tool, setTool] = useState<ToolDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = (
      TOOL_LOADERS as Record<
        string,
        (() => Promise<{ default: ToolDefinition }>) | undefined
      >
    )[slug];
    if (!loader) {
      setLoadError(`Unknown tool "${slug}".`);
      return;
    }
    loader().then((mod) => {
      if (cancelled) return;
      setTool(mod.default);
      setOptions(mod.default.defaults as Record<string, unknown>);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const allJobs = jobStore(selectOrderedJobs);
  const jobs = tool ? allJobs.filter((j) => j.toolSlug === tool.slug) : [];

  const handleFiles = useCallback(
    (accepted: AcceptedFile[], rejectedFiles: RejectedFile[]) => {
      setRejected(rejectedFiles);
      if (!tool || accepted.length === 0) return;
      getAppJobEngine().submit(
        tool,
        accepted.map((a) => ({ file: a.file, format: a.format })),
        options,
      );
    },
    [tool, options],
  );

  const handleCancel = useCallback((id: string) => {
    getAppJobEngine().cancel(id);
  }, []);

  const handleRemove = useCallback((id: string) => {
    jobStore.getState().remove(id);
  }, []);

  const handleClear = useCallback(() => {
    for (const job of jobs) {
      if (job.status === "queued" || job.status === "running") {
        getAppJobEngine().cancel(job.id);
      }
      jobStore.getState().remove(job.id);
    }
  }, [jobs]);

  const handleDownloadAll = useCallback(async () => {
    if (!tool) return;
    const doneIds = jobs.filter((j) => j.status === "done").map((j) => j.id);
    if (doneIds.length < 2) return;

    setZipping(true);
    setZipError(null);
    try {
      const stream = await getAppJobEngine().zipOutputs(doneIds);
      const blob = await collectToBlob(stream, "application/zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `localvert-${tool.slug}-${doneIds.length}-files.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // The zip worker failing to load/mid-stream (see spawn.ts's
      // `workerFailure`) surfaces here as a rejection rather than a hang —
      // every done job's own download link still works, so this is
      // recoverable rather than fatal.
      setZipError("Couldn't build the zip — download files individually.");
    } finally {
      setZipping(false);
    }
  }, [tool, jobs]);

  if (loadError) {
    return <p className="text-sm text-danger">{loadError}</p>;
  }
  if (!tool) {
    return <p className="text-sm text-ink-muted">Loading converter…</p>;
  }

  const hasOptions = Object.keys(tool.options.shape).length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Dropzone
        accepts={tool.accepts}
        multiple={tool.batch}
        onFiles={handleFiles}
      />

      {rejected.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rejected.map((r) => (
            <li
              key={`${r.file.name}-${r.file.size}`}
              className="text-xs text-danger"
            >
              <span className="font-medium">{r.file.name}</span>:{" "}
              {rejectionMessage(r)}
            </li>
          ))}
        </ul>
      )}

      {hasOptions && (
        <OptionsForm
          schema={tool.options}
          defaults={tool.defaults}
          value={options}
          onChange={setOptions}
        />
      )}

      <JobList
        jobs={jobs}
        onCancel={handleCancel}
        onRemove={handleRemove}
        onDownloadAll={handleDownloadAll}
        onClear={handleClear}
        zipping={zipping}
      />

      {zipError && <p className="text-sm text-danger">{zipError}</p>}
    </div>
  );
}
