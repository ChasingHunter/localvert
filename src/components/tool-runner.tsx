"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { Rect } from "@/components/crop-geometry";
import { Dropzone } from "@/components/dropzone";
import {
  type AcceptedFile,
  classifyFiles,
  type RejectedFile,
} from "@/components/dropzone-logic";
import { FileOrderList } from "@/components/file-order-list";
import { JobList } from "@/components/job-list";
import { Button } from "@/components/ui/button";
import { takePendingFiles } from "@/lib/converter/handoff";
import {
  downloadBytes,
  enginesNeedingConsent,
  grantConsent,
  hasConsent,
} from "@/lib/engines/consent";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { jobStore, selectOrderedJobs } from "@/lib/jobs/store";
import { FORMATS, formatFromFilename } from "@/lib/registry/formats";
import type { EngineId, ToolDefinition } from "@/lib/registry/types";
import { collectToBlob } from "@/lib/sinks/collect";
import { TOOL_LOADERS } from "@/tools/loaders";

/**
 * Upstream source repository per consent-gated engine, for the GPL
 * source-offer link in `EngineConsentDialog` (ADR-0002 rule 5) — kept here,
 * not in the generated manifest, since it's a UI-only concern and only
 * engines with `consent: true` ever need it.
 */
const ENGINE_SOURCE_URLS: Partial<Record<EngineId, string>> = {
  ffmpeg: "https://github.com/ffmpegwasm/ffmpeg.wasm",
  // The npm package's own page — it has no repository field or README (see
  // docs/adr/0012-libreoffice-office-to-pdf.md's provenance note). The
  // corresponding LibreOffice *core* source (MPL-2.0's actual obligation,
  // since this package is a wasm build of it, not a fork) is linked from
  // that ADR instead of here — this dialog only ever shows one link.
  libreoffice: "https://www.npmjs.com/package/@bentopdf/libreoffice-wasm",
};

/**
 * Same code-splitting reasoning as `OptionsForm`/`CropEditor` above: most
 * tool pages use no `consent: true` engine at all (only `ffmpeg`-backed
 * tools do today), so this only downloads for a page that actually needs
 * the prompt.
 */
const EngineConsentDialog = dynamic(
  () =>
    import("@/components/engine-consent-dialog").then(
      (mod) => mod.EngineConsentDialog,
    ),
  { ssr: false },
);

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

/**
 * Whether every one of a tool's `requiredOptionKeys` currently holds a
 * non-blank value in `values` — the same rule `requiredFieldsSatisfied`
 * (src/lib/options/fields.ts) applies, kept as a small local copy operating
 * on plain option keys instead of `FieldSpec`s so this file never imports
 * zod (see `hasCropField`'s doc comment above on why that matters). Used to
 * decide, at drop time, whether a required-field tool can submit
 * immediately (the field was already filled in before the drop) or must
 * hold the file back for the explicit action button instead.
 */
function requiredKeysSatisfied(
  keys: readonly string[],
  values: Readonly<Record<string, unknown>>,
): boolean {
  return keys.every((key) => {
    const value = values[key];
    return typeof value === "string"
      ? value.trim() !== ""
      : value !== undefined && value !== null;
  });
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
  // Files staged for a tool with at least one `required` option (e.g.
  // `protect-pdf`'s `password`) whose value wasn't filled in yet at drop
  // time — held back instead of submitted, since submitting would either
  // run with a blank value or need the job cancelled and retried. A
  // required field already filled in *before* the drop never reaches this
  // state at all (see `requiredKeysSatisfied` above) — it submits
  // immediately like any other tool. `canSubmit` mirrors `OptionsForm`'s
  // own `requiredFieldsSatisfied` check (reported up via its
  // `onValidityChange`) and starts `true` so a tool with no required fields
  // is never blocked before its options even mount.
  const [pendingRequiredFiles, setPendingRequiredFiles] = useState<
    AcceptedFile[]
  >([]);
  const [canSubmit, setCanSubmit] = useState(true);
  // ADR-0008, arity "many-to-one" (e.g. merge-pdf): files accumulate here
  // across drops instead of submitting immediately, in the order the user
  // arranges them via `FileOrderList` — submission is the explicit
  // `actionLabel` button below, not on-drop.
  const [orderedFiles, setOrderedFiles] = useState<AcceptedFile[]>([]);
  // The job currently being zipped via a `JobCard`'s own per-job
  // "Download all (.zip)" (one-to-many outputs) — a separate concern from
  // `zipping`/`zipError` above, which track the cross-job "download all".
  const [zippingJobId, setZippingJobId] = useState<string | null>(null);
  const [jobZipError, setJobZipError] = useState<string | null>(null);
  // ADR-0002 rule 4: a submission blocked on the user agreeing to download a
  // `consent: true` engine (e.g. ffmpeg). `proceed` is the exact submission
  // that was about to run — `handleConsentDownload` calls it once consent is
  // granted, with no need to re-derive which files/options it was for.
  const [consentGate, setConsentGate] = useState<{
    engineId: EngineId;
    proceed: () => void;
  } | null>(null);
  const [consentDeclined, setConsentDeclined] = useState<string | null>(null);

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
  const isManyToOne = tool?.arity === "many-to-one";
  // Plain string array on the tool definition itself (see its doc comment
  // in `src/lib/registry/types.ts`) — read structurally, same as
  // `hasCropField` above, so this file never imports zod just to check it.
  const hasRequiredOptions = (tool?.requiredOptionKeys?.length ?? 0) > 0;

  /**
   * ADR-0002 rule 4's gate, wrapping every path below that would otherwise
   * call `jobEngine().submit(...)` directly. `enginesNeedingConsent` reads
   * only the (already-loaded, engine-code-free) `ENGINE_MANIFEST` — no
   * engine adapter is touched until consent is actually granted. If every
   * engine this submission might reach already has stored consent (or
   * needs none), `proceed` runs immediately and no dialog ever renders. If
   * not, `proceed` is held in `consentGate` until `handleConsentDownload`
   * or `handleConsentCancel` resolves it; re-entrant by construction, so a
   * tool needing two consent-gated engines asks once per engine in turn.
   */
  const ensureConsent = useCallback(
    (proceed: () => void) => {
      setConsentDeclined(null);
      if (!tool) return;
      const needed = enginesNeedingConsent(tool, ENGINE_MANIFEST);
      const ungranted = needed.find(
        (id) =>
          !hasConsent(window.localStorage, id, ENGINE_MANIFEST[id].version),
      );
      if (!ungranted) {
        proceed();
        return;
      }
      setConsentGate({ engineId: ungranted, proceed });
    },
    [tool],
  );

  const handleConsentDownload = useCallback(() => {
    if (!consentGate) return;
    const { engineId, proceed } = consentGate;
    grantConsent(
      window.localStorage,
      engineId,
      ENGINE_MANIFEST[engineId].version,
    );
    setConsentGate(null);
    // Re-run the gate: covers a submission that needs more than one
    // consent-gated engine, and is a no-op (calls `proceed` straight away)
    // for the common case of exactly one.
    ensureConsent(proceed);
  }, [consentGate, ensureConsent]);

  const handleConsentCancel = useCallback(() => {
    if (!consentGate) return;
    setConsentDeclined(
      `Not converted — the ${consentGate.engineId} engine wasn't downloaded.`,
    );
    setConsentGate(null);
  }, [consentGate]);

  const handleFiles = useCallback(
    (accepted: AcceptedFile[], rejectedFiles: RejectedFile[]) => {
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
      if (isManyToOne) {
        // Accumulate across drops instead of submitting — see
        // `handleSubmitOrdered` for the explicit submit this arity uses.
        setOrderedFiles((prev) => [...prev, ...accepted]);
        return;
      }
      if (
        hasRequiredOptions &&
        !requiredKeysSatisfied(tool.requiredOptionKeys ?? [], options)
      ) {
        // Staged, not submitted — see `handleSubmitPending`. A required
        // field already filled in *before* the drop (e.g. password typed
        // first) skips this and submits immediately below, same as any
        // other tool.
        setPendingRequiredFiles((prev) => [...prev, ...accepted]);
        return;
      }
      ensureConsent(async () => {
        const engine = await jobEngine();
        engine.submit(
          tool,
          accepted.map((a) => ({ file: a.file, format: a.format })),
          options,
        );
      });
    },
    [
      tool,
      options,
      hasCropField,
      isManyToOne,
      hasRequiredOptions,
      ensureConsent,
    ],
  );

  // ADR-0015: the Converter island hands files over in-memory rather than
  // navigating with them in the URL — see `handoff.ts`'s doc comment. Runs
  // once `tool` is loaded (so `tool.accepts` is known) and consumes the
  // one-shot store; a normal page load or hard reload finds nothing there
  // and this is a no-op. Reuses `classifyFiles` (not a duplicate sniff)
  // so a handed-off file is detected and accepted/rejected exactly as if
  // it had been dropped here directly. `tool` is the only real dependency:
  // `handleFiles` is recreated every render (it closes over `options`, which
  // the handed-off files should be submitted with at the moment they're
  // consumed), so listing it would risk re-consuming an already-emptied
  // one-shot store on an unrelated re-render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally scoped to `tool` — see comment above.
  useEffect(() => {
    if (!tool) return;
    const files = takePendingFiles(tool.slug);
    if (!files || files.length === 0) return;
    classifyFiles(files, tool.accepts).then(({ accepted, rejected }) => {
      handleFiles(accepted, rejected);
    });
  }, [tool]);

  const handleSubmitPending = useCallback(() => {
    if (!tool || pendingRequiredFiles.length === 0 || !canSubmit) return;
    const files = pendingRequiredFiles;
    ensureConsent(async () => {
      const engine = await jobEngine();
      engine.submit(
        tool,
        files.map((a) => ({ file: a.file, format: a.format })),
        options,
      );
      setPendingRequiredFiles([]);
    });
  }, [tool, pendingRequiredFiles, options, canSubmit, ensureConsent]);

  const handleSubmitOrdered = useCallback(() => {
    if (!tool || orderedFiles.length < 2) return;
    const files = orderedFiles;
    ensureConsent(async () => {
      const engine = await jobEngine();
      engine.submit(
        tool,
        files.map((a) => ({ file: a.file, format: a.format })),
        options,
      );
      setOrderedFiles([]);
    });
  }, [tool, orderedFiles, options, ensureConsent]);

  const handleCropSubmit = useCallback(
    (crop: Rect) => {
      if (!tool || !cropTarget) return;
      const target = cropTarget;
      ensureConsent(async () => {
        const engine = await jobEngine();
        engine.submit(tool, [{ file: target.file, format: target.format }], {
          ...options,
          crop,
        });
        setCropTarget(null);
      });
    },
    [tool, cropTarget, options, ensureConsent],
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

  /** ADR-0008: zips one job's own multiple `outputs` (one-to-many, e.g.
   * split-pdf) — `zipOutputs([id])` scopes the zip sink to just that job,
   * see `job-engine.ts`'s `outputBlobs`. */
  const handleDownloadJobOutputs = useCallback(
    async (id: string) => {
      if (!tool) return;
      setZippingJobId(id);
      setJobZipError(null);
      try {
        const engine = await jobEngine();
        const stream = await engine.zipOutputs([id]);
        const blob = await collectToBlob(stream, "application/zip");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `localvert-${tool.slug}-${id}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setJobZipError("Couldn't build the zip — download files individually.");
      } finally {
        setZippingJobId(null);
      }
    },
    [tool],
  );

  if (loadError) {
    return <p className="text-sm text-danger">{loadError}</p>;
  }
  if (!tool) {
    return <p className="text-sm text-ink-muted">Loading converter…</p>;
  }

  const hasOptions = Object.keys(tool.options.shape).length > 0;

  return (
    // The drop area/job list stay the main panel; a tool's options sit in a
    // quiet side column once there's room for one (ADR-0016's tool-page
    // layout) — `lg:grid-cols-[1fr_18rem]` only takes effect at 1024px, so
    // below that this is a single stacked column with options rendered
    // after the main flow, in the same source order either way.
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem] lg:items-start">
      <div className="flex flex-col gap-6">
        {/* Hidden mid-crop: a second drop would orphan the file already being
            cropped, and `cropTarget` is the only file this tool page can edit
            at once (crop tools are never batch). */}
        {!(hasCropField && cropTarget) && (
          <Dropzone
            accepts={tool.accepts}
            multiple={tool.batch || isManyToOne}
            onFiles={handleFiles}
          />
        )}

        {isManyToOne && orderedFiles.length > 0 && (
          <div className="flex flex-col gap-3">
            <FileOrderList files={orderedFiles} onChange={setOrderedFiles} />
            <Button
              type="button"
              onClick={handleSubmitOrdered}
              disabled={orderedFiles.length < 2}
            >
              {tool.actionLabel ?? "Convert"}
            </Button>
          </div>
        )}

        {hasRequiredOptions && pendingRequiredFiles.length > 0 && (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-1 text-sm text-ink-muted">
              {pendingRequiredFiles.map((f) => (
                <li key={`${f.file.name}-${f.file.size}`}>{f.file.name}</li>
              ))}
            </ul>
            <Button
              type="button"
              onClick={handleSubmitPending}
              disabled={!canSubmit}
            >
              {tool.actionLabel ?? "Convert"}
            </Button>
          </div>
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

        <JobList
          jobs={jobs}
          onCancel={handleCancel}
          onRemove={handleRemove}
          onDownloadAll={handleDownloadAll}
          onClear={handleClear}
          zipping={zipping}
          onDownloadJobOutputs={handleDownloadJobOutputs}
          zippingJobId={zippingJobId}
        />

        {zipError && <p className="text-sm text-danger">{zipError}</p>}
        {jobZipError && <p className="text-sm text-danger">{jobZipError}</p>}
        {consentDeclined && (
          <p className="text-sm text-ink-muted">{consentDeclined}</p>
        )}
      </div>

      {hasOptions && (
        <aside aria-label="Options" className="flex flex-col gap-5">
          <OptionsForm
            schema={tool.options}
            defaults={tool.defaults}
            value={options}
            onChange={setOptions}
            onValidityChange={setCanSubmit}
          />
        </aside>
      )}

      {consentGate && (
        <EngineConsentDialog
          open={true}
          engineId={consentGate.engineId}
          license={ENGINE_MANIFEST[consentGate.engineId].license}
          bytes={downloadBytes(ENGINE_MANIFEST[consentGate.engineId])}
          sourceUrl={ENGINE_SOURCE_URLS[consentGate.engineId] ?? "#"}
          onDownload={handleConsentDownload}
          onCancel={handleConsentCancel}
        />
      )}
    </div>
  );
}
