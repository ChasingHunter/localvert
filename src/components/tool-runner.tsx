"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { Rect } from "@/components/crop-geometry";
import { Dropzone } from "@/components/dropzone";
import type { AcceptedFile, RejectedFile } from "@/components/dropzone-logic";
import { JobList } from "@/components/job-list";
import { jobStore, selectOrderedJobs } from "@/lib/jobs/store";
import { FORMATS, formatFromFilename } from "@/lib/registry/formats";
import type { ToolDefinition } from "@/lib/registry/types";
import { collectToBlob } from "@/lib/sinks/collect";
import { TOOL_LOADERS } from "@/tools/loaders";

/**
 * The options form pulls in radix primitives (select/slider/switch) that
 * most tools never render (`jpg-to-png` has no options at all) — code-split
 * it so those primitives only download for a tool whose schema actually has
 * fields, instead of shipping with every tool page. `ssr: false` because
 * this whole component only mounts client-side anyway (see `ToolRunner`'s
 * doc comment: `tool` is null during the static export's render pass, so
 * nothing here is ever server-rendered regardless).
 */
const OptionsForm = dynamic(
  () => import("@/components/options-form").then((mod) => mod.OptionsForm),
  { ssr: false },
);

/**
 * Same code-splitting reasoning as `OptionsForm` above, doubly so here: the
 * crop editor's pointer/keyboard drag math and its extra UI never download
 * for the vast majority of tool pages, which have no crop field at all.
 */
const CropEditor = dynamic(
  () => import("@/components/crop-editor").then((mod) => mod.CropEditor),
  { ssr: false },
);

/**
 * The job engine (worker pool, router capability probes, comlink, the engine
 * manifest) is real weight — see docs/ARCHITECTURE.md's size budget. No tool
 * page needs any of it until a file actually arrives, so it's imported here
 * lazily on first use instead of loading with the page. `import()` caches
 * the module after the first call, so repeated calls resolve immediately.
 */
async function jobEngine() {
  const { getAppJobEngine } = await import("@/lib/jobs/app");
  return getAppJobEngine();
}

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
 * separate "convert" button. The one exception is a tool with a "crop"
 * option field (see `hasCropField` below): a crop only makes sense chosen
 * against the actual dropped image, so those tools show a `CropEditor`
 * instead and submit only once its own "Crop" button is pressed.
 */
export function ToolRunner({ slug }: ToolRunnerProps) {
  const [tool, setTool] = useState<ToolDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<AcceptedFile | null>(null);

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

  // Derived from the schema, not a per-tool flag: any tool whose options
  // include a "crop" field (by convention every crop-*.ts tool names it
  // exactly "crop" — see `cropField` in src/tools/_shared-options.ts) gets
  // the crop-editor flow below instead of submitting on drop. Checked
  // structurally (same as `hasOptions` below) rather than via
  // `describeFields` (src/lib/options/fields.ts), so this file doesn't
  // statically pull zod into every tool page's route bundle — that only
  // ever loads lazily, inside the tool's own dynamically-imported chunk
  // (`TOOL_LOADERS[slug]()` above).
  const hasCropField = tool ? "crop" in tool.options.shape : false;

  const handleFiles = useCallback(
    async (accepted: AcceptedFile[], rejectedFiles: RejectedFile[]) => {
      setRejected(rejectedFiles);
      if (!tool || accepted.length === 0) return;
      if (hasCropField) {
        // Crop tools are never batch (`defineTool`'s `batch: false`), so
        // the dropzone itself already restricts this to one file — only
        // its first entry can exist.
        const [first] = accepted;
        if (first) setCropTarget(first);
        return;
      }
      const engine = await jobEngine();
      engine.submit(
        tool,
        accepted.map((a) => ({ file: a.file, format: a.format })),
        options,
      );
    },
    [tool, options, hasCropField],
  );

  const handleCropSubmit = useCallback(
    async (crop: Rect) => {
      if (!tool || !cropTarget) return;
      const engine = await jobEngine();
      engine.submit(
        tool,
        [{ file: cropTarget.file, format: cropTarget.format }],
        { ...options, crop },
      );
      setCropTarget(null);
    },
    [tool, cropTarget, options],
  );

  const handleCropCancel = useCallback(() => {
    setCropTarget(null);
  }, []);

  const handleCancel = useCallback(async (id: string) => {
    const engine = await jobEngine();
    engine.cancel(id);
  }, []);

  const handleRemove = useCallback((id: string) => {
    jobStore.getState().remove(id);
  }, []);

  const handleClear = useCallback(async () => {
    const cancellable = jobs.filter(
      (job) => job.status === "queued" || job.status === "running",
    );
    if (cancellable.length > 0) {
      const engine = await jobEngine();
      for (const job of cancellable) engine.cancel(job.id);
    }
    for (const job of jobs) {
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
      const engine = await jobEngine();
      const stream = await engine.zipOutputs(doneIds);
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
      {/* Hidden mid-crop: a second drop would orphan the file already being
          cropped, and `cropTarget` is the only file this tool page can edit
          at once (crop tools are never batch). */}
      {!(hasCropField && cropTarget) && (
        <Dropzone
          accepts={tool.accepts}
          multiple={tool.batch}
          onFiles={handleFiles}
        />
      )}

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

      {hasCropField && cropTarget && (
        <CropEditor
          file={cropTarget.file}
          onSubmit={handleCropSubmit}
          onCancel={handleCropCancel}
        />
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
