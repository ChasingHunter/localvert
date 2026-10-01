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
import { PrivacyNote } from "@/components/privacy-note";
import {
  nextRunFiles,
  sameOptions,
  shouldShowRerun,
} from "@/components/rerun-logic";
import { Button } from "@/components/ui/button";
import { takePendingFiles } from "@/lib/converter/handoff";
import type { ConsentPrompt } from "@/lib/engines/consent-gate";
import { engineDisplayName } from "@/lib/engines/display-names";
import { shouldStageForEstimate } from "@/lib/estimate/stage";
import { jobStore, selectOrderedJobs } from "@/lib/jobs/store";
import { isFormField, requiredFieldsSatisfied } from "@/lib/options/field-spec";
import type { ClientTool } from "@/lib/registry/client-tool";
import { FORMATS, formatFromFilename } from "@/lib/registry/formats";
import { isReady } from "@/lib/registry/readiness";
import { collectToBlob } from "@/lib/sinks/collect";

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
 * Same code-splitting reasoning as `CropEditor` above: only the two
 * `rangeStage` video tools (trim, video to GIF) ever show this.
 */
const VideoRangeEditor = dynamic(
  () =>
    import("@/components/video-range-editor").then(
      (mod) => mod.VideoRangeEditor,
    ),
  { ssr: false },
);

/**
 * Same code-splitting reasoning as `OptionsForm`/`CropEditor` above: only the
 * three ADR-0017 compress tools (`estimateKind` set) ever stage a file for
 * this, so no other tool page should download it.
 */
const SizeEstimate = dynamic(
  () => import("@/components/size-estimate").then((mod) => mod.SizeEstimate),
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
  tool: ClientTool;
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
 * CLIENT COMPONENT. Receives its tool as a `ClientTool` prop (ADR-0019): the
 * tool page, a server component, builds that plain data from the registry at
 * build time, so it arrives with the page itself. This file never loads a tool
 * module or the `TOOLS` barrel, which would put zod and every other tool's
 * pipeline on the main thread. The real tool definition (and its zod schema)
 * is only ever loaded inside the worker that runs the job.
 *
 * Owns: the dropzone, the options form (hidden when the tool has no
 * options), and the job list for this tool. Submission happens immediately
 * on drop, using whatever options are set at that moment — there is no
 * separate "convert" button. The one exception is a tool with a "crop"
 * option field (see `hasCropField` below): a crop only makes sense chosen
 * against the actual dropped image, so those tools show a `CropEditor`
 * instead and submit only once its own "Crop" button is pressed.
 */
export function ToolRunner({ tool }: ToolRunnerProps) {
  const [options, setOptions] = useState<Record<string, unknown>>(
    tool.defaults,
  );
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<AcceptedFile | null>(null);
  // The video staged for a `rangeStage` tool (trim / video to GIF): shown in
  // `VideoRangeEditor` until its run button is pressed, like `cropTarget`.
  const [rangeTarget, setRangeTarget] = useState<AcceptedFile | null>(null);
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
  // ADR-0017's "Estimates" addendum (2026-09-30): a file dropped on one of
  // the three compress tools (`tool.estimateKind`) while its `mode` is a
  // target-size/percent mode (`shouldStageForEstimate`) — held back the same
  // way `pendingRequiredFiles` is, but for a different reason: the job might
  // be unreachable, so running it immediately (every mode's behaviour before
  // this slice) would spend a real encode before the user has any idea
  // whether the number they typed is realistic. "Best quality" and every
  // fixed-preset mode (custom/lossless/balanced/strong) are unaffected —
  // they keep submitting on drop, since there's no target to show an
  // estimate against and no staging pause to show one in anyway.
  const [estimateStagedFiles, setEstimateStagedFiles] = useState<
    AcceptedFile[]
  >([]);
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
    prompt: ConsentPrompt;
    proceed: () => void;
  } | null>(null);
  const [consentDeclined, setConsentDeclined] = useState<string | null>(null);
  // The files (just `File` references the browser already holds) and options
  // of the last direct run, so "Run again with new settings" can repeat it.
  const [lastRun, setLastRun] = useState<{
    files: AcceptedFile[];
    options: Record<string, unknown>;
  } | null>(null);

  const allJobs = jobStore(selectOrderedJobs);
  const jobs = allJobs.filter((j) => j.toolSlug === tool.slug);

  // Derived from the field descriptors, not a per-tool flag: any tool whose
  // options include a "crop" field (by convention every crop-*.ts tool names
  // it exactly "crop" — see `cropField` in src/tools/_shared-options.ts) gets
  // the crop-editor flow below instead of submitting on drop.
  const hasCropField = tool.fields.some((f) => f.control === "crop");
  const isManyToOne = tool.arity === "many-to-one";
  const rangeStage = tool.rangeStage;
  const readiness = tool.readiness;
  const hasRequiredOptions =
    tool.fields.some((f) => f.required) || readiness !== undefined;
  /** Every `required` field is filled and the tool's own readiness rule
   * (if any) holds for these options. */
  const optionsReady = useCallback(
    (values: Readonly<Record<string, unknown>>) =>
      requiredFieldsSatisfied(tool.fields, values) &&
      (readiness ? isReady(readiness, values) : true),
    [tool, readiness],
  );

  /**
   * ADR-0002 rule 4's gate, wrapping every path below that would otherwise
   * call `jobEngine().submit(...)` directly. The manifest-aware half
   * (`consent-gate.ts`) is imported lazily here, so the engine manifest is
   * not part of the page's first load; it reads only that engine-code-free
   * manifest — no engine adapter is touched until consent is granted. If every
   * engine this submission might reach already has stored consent (or
   * needs none), `proceed` runs immediately and no dialog ever renders. If
   * not, `proceed` is held in `consentGate` until `handleConsentDownload`
   * or `handleConsentCancel` resolves it; re-entrant by construction, so a
   * tool needing two consent-gated engines asks once per engine in turn.
   */
  const ensureConsent = useCallback(
    async (proceed: () => void) => {
      setConsentDeclined(null);
      const { pendingConsentPrompt } = await import(
        "@/lib/engines/consent-gate"
      );
      const prompt = pendingConsentPrompt(tool, window.localStorage);
      if (!prompt) {
        proceed();
        return;
      }
      setConsentGate({ prompt, proceed });
    },
    [tool],
  );

  const handleConsentDownload = useCallback(async () => {
    if (!consentGate) return;
    const { prompt, proceed } = consentGate;
    const { grantEngineConsent } = await import("@/lib/engines/consent-gate");
    grantEngineConsent(window.localStorage, prompt.engineId);
    setConsentGate(null);
    // Re-run the gate: covers a submission that needs more than one
    // consent-gated engine, and is a no-op (calls `proceed` straight away)
    // for the common case of exactly one.
    void ensureConsent(proceed);
  }, [consentGate, ensureConsent]);

  const handleConsentCancel = useCallback(() => {
    if (!consentGate) return;
    setConsentDeclined(
      `Not converted. ${engineDisplayName(consentGate.prompt.engineId)} wasn't downloaded.`,
    );
    setConsentGate(null);
  }, [consentGate]);

  /** Remembers what a direct (non-staged) run used, for "Run again". */
  const rememberRun = useCallback(
    (files: AcceptedFile[], used: Record<string, unknown>) => {
      const hasJobs = jobs.length > 0;
      setLastRun((prev) => ({
        files: nextRunFiles(
          prev?.files ?? [],
          files,
          prev !== null && sameOptions(prev.options, used),
          hasJobs,
        ),
        options: used,
      }));
    },
    [jobs.length],
  );

  /** Routes files for a one-to-one tool: stage them if something must be
   * filled in first, otherwise run straight away. Used by drops and by
   * "Run again", so both honour the same staging rules. */
  const submitOrStage = useCallback(
    (accepted: AcceptedFile[]) => {
      if (hasRequiredOptions && !optionsReady(options)) {
        // Staged, not submitted — see `handleSubmitPending`. A required
        // field already filled in *before* the drop (e.g. password typed
        // first) skips this and submits immediately below, same as any
        // other tool.
        setPendingRequiredFiles((prev) => [...prev, ...accepted]);
        return;
      }
      if (shouldStageForEstimate(tool.estimateKind, options)) {
        // Staged, not submitted — see `handleSubmitEstimateStaged` and
        // `estimateStagedFiles`'s own doc comment above.
        setEstimateStagedFiles((prev) => [...prev, ...accepted]);
        return;
      }
      const used = options;
      void ensureConsent(async () => {
        const engine = await jobEngine();
        engine.submit(
          tool,
          accepted.map((a) => ({ file: a.file, format: a.format })),
          used,
        );
        rememberRun(accepted, used);
      });
    },
    [
      tool,
      options,
      hasRequiredOptions,
      optionsReady,
      ensureConsent,
      rememberRun,
    ],
  );

  const handleFiles = useCallback(
    (accepted: AcceptedFile[], rejectedFiles: RejectedFile[]) => {
      setRejected(rejectedFiles);
      if (accepted.length === 0) return;
      if (hasCropField) {
        // Crop tools are never batch (`defineTool`'s `batch: false`), so
        // the dropzone itself already restricts this to one file — only
        // its first entry can exist.
        const [first] = accepted;
        if (first) setCropTarget(first);
        return;
      }
      if (rangeStage) {
        // One video at a time, previewed before running — see
        // `handleRangeSubmit`.
        const [first] = accepted;
        if (first) setRangeTarget(first);
        return;
      }
      if (isManyToOne) {
        // Accumulate across drops instead of submitting — see
        // `handleSubmitOrdered` for the explicit submit this arity uses.
        setOrderedFiles((prev) => [...prev, ...accepted]);
        return;
      }
      submitOrStage(accepted);
    },
    [hasCropField, rangeStage, isManyToOne, submitOrStage],
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
    const files = takePendingFiles(tool.slug);
    if (!files || files.length === 0) return;
    classifyFiles(files, tool.accepts).then(({ accepted, rejected }) => {
      handleFiles(accepted, rejected);
    });
  }, [tool]);

  const handleSubmitPending = useCallback(() => {
    if (pendingRequiredFiles.length === 0 || !canSubmit) return;
    if (!optionsReady(options)) return;
    const files = pendingRequiredFiles;
    void ensureConsent(async () => {
      const engine = await jobEngine();
      engine.submit(
        tool,
        files.map((a) => ({ file: a.file, format: a.format })),
        options,
      );
      setPendingRequiredFiles([]);
    });
  }, [
    tool,
    pendingRequiredFiles,
    options,
    canSubmit,
    optionsReady,
    ensureConsent,
  ]);

  const handleSubmitEstimateStaged = useCallback(() => {
    if (estimateStagedFiles.length === 0) return;
    const files = estimateStagedFiles;
    void ensureConsent(async () => {
      const engine = await jobEngine();
      engine.submit(
        tool,
        files.map((a) => ({ file: a.file, format: a.format })),
        options,
      );
      setEstimateStagedFiles([]);
    });
  }, [tool, estimateStagedFiles, options, ensureConsent]);

  const handleSubmitOrdered = useCallback(() => {
    if (orderedFiles.length < 2) return;
    const files = orderedFiles;
    void ensureConsent(async () => {
      const engine = await jobEngine();
      engine.submit(
        tool,
        files.map((a) => ({ file: a.file, format: a.format })),
        options,
      );
      rememberRun(files, options);
      setOrderedFiles([]);
    });
  }, [tool, orderedFiles, options, ensureConsent, rememberRun]);

  const handleCropSubmit = useCallback(
    (crop: Rect) => {
      if (!cropTarget) return;
      const target = cropTarget;
      void ensureConsent(async () => {
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

  const handleRangeSubmit = useCallback(() => {
    if (!rangeTarget) return;
    const target = rangeTarget;
    const used = options;
    void ensureConsent(async () => {
      const engine = await jobEngine();
      engine.submit(tool, [{ file: target.file, format: target.format }], used);
      rememberRun([target], used);
      setRangeTarget(null);
    });
  }, [tool, rangeTarget, options, ensureConsent, rememberRun]);

  const handleRangeOptions = useCallback((patch: Record<string, number>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleRangeCancel = useCallback(() => {
    setRangeTarget(null);
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

  const handleRerun = useCallback(async () => {
    if (!lastRun) return;
    const files = lastRun.files;
    // Same path as "Clear": cancels anything live, then `remove` revokes each
    // result's object URL.
    await handleClear();
    if (isManyToOne) {
      const used = options;
      void ensureConsent(async () => {
        const engine = await jobEngine();
        engine.submit(
          tool,
          files.map((a) => ({ file: a.file, format: a.format })),
          used,
        );
        setLastRun({ files, options: used });
      });
      return;
    }
    submitOrStage(files);
  }, [
    tool,
    lastRun,
    handleClear,
    isManyToOne,
    options,
    ensureConsent,
    submitOrStage,
  ]);

  const handleDownloadAll = useCallback(async () => {
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
      setZipError(
        "Couldn't build the zip. Download files individually instead.",
      );
    } finally {
      setZipping(false);
    }
  }, [tool, jobs]);

  /** ADR-0008: zips one job's own multiple `outputs` (one-to-many, e.g.
   * split-pdf) — `zipOutputs([id])` scopes the zip sink to just that job,
   * see `job-engine.ts`'s `outputBlobs`. */
  const handleDownloadJobOutputs = useCallback(
    async (id: string) => {
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
        setJobZipError(
          "Couldn't build the zip. Download files individually instead.",
        );
      } finally {
        setZippingJobId(null);
      }
    },
    [tool],
  );

  // Only fields that actually render count (crop and hidden ones don't), so
  // crop tools with nothing else to show don't get an empty options column.
  const hasOptions = tool.fields.some(isFormField);
  const showRerun = shouldShowRerun({
    hasOptions,
    hasCropField,
    lastOptions: lastRun?.options ?? null,
    currentOptions: options,
    jobStatuses: jobs.map((j) => j.status),
    hasStagedFiles:
      rangeTarget !== null ||
      orderedFiles.length > 0 ||
      pendingRequiredFiles.length > 0 ||
      estimateStagedFiles.length > 0,
  });

  return (
    // The drop area/job list stay the main panel; a tool's options sit in a
    // quiet side column once there's room for one (ADR-0016's tool-page
    // layout) — `lg:grid-cols-[1fr_18rem]` only takes effect at 1024px, so
    // below that this is a single stacked column with options rendered
    // after the main flow, in the same source order either way. A tool with
    // no options (most of them — `jpg-to-png` has none at all) gets no
    // second column at all: the grid track was reserving 18rem of empty
    // space next to a narrower main panel even with nothing to put there
    // (design review), so this only switches to the two-column grid once
    // there's an `<aside>` to fill it.
    <div
      className={
        hasOptions
          ? "grid gap-6 lg:grid-cols-[1fr_18rem] lg:items-start"
          : "flex flex-col gap-6"
      }
    >
      <div className="flex flex-col gap-6">
        {/* Hidden mid-crop: a second drop would orphan the file already being
            cropped, and `cropTarget` is the only file this tool page can edit
            at once (crop tools are never batch). */}
        {!(hasCropField && cropTarget) && !(rangeStage && rangeTarget) && (
          <>
            <PrivacyNote size="sm" />
            <Dropzone
              accepts={tool.accepts}
              multiple={(tool.batch || isManyToOne) && !rangeStage}
              onFiles={handleFiles}
              hideFooterNote
            />
          </>
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
              disabled={!canSubmit || !optionsReady(options)}
            >
              {tool.actionLabel ?? "Convert"}
            </Button>
            {readiness && !isReady(readiness, options) && (
              <p className="text-sm text-ink-muted">{readiness.hint}</p>
            )}
          </div>
        )}

        {tool.estimateKind && estimateStagedFiles.length > 0 && (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2 text-sm text-ink-muted">
              {estimateStagedFiles.map((f) => (
                <li key={`${f.file.name}-${f.file.size}`}>
                  <span>{f.file.name}</span>
                  <SizeEstimate
                    tool={tool}
                    file={f.file}
                    sourceFormat={f.format}
                    options={options}
                  />
                </li>
              ))}
            </ul>
            <Button type="button" onClick={handleSubmitEstimateStaged}>
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

        {rangeStage && rangeTarget && (
          <VideoRangeEditor
            file={rangeTarget.file}
            kind={rangeStage}
            options={options}
            onOptionsChange={handleRangeOptions}
            onSubmit={handleRangeSubmit}
            onCancel={handleRangeCancel}
            submitLabel={tool.actionLabel ?? "Run"}
          />
        )}

        {showRerun && (
          <div>
            <Button type="button" onClick={() => void handleRerun()}>
              Run again with new settings
            </Button>
          </div>
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
          showSaving={
            tool.neverLarger === true ||
            tool.estimateKind !== undefined ||
            tool.slug.startsWith("compress-")
          }
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
            fields={tool.fields}
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
          engineId={consentGate.prompt.engineId}
          license={consentGate.prompt.license}
          bytes={consentGate.prompt.bytes}
          sourceUrl={consentGate.prompt.sourceUrl}
          onDownload={handleConsentDownload}
          onCancel={handleConsentCancel}
        />
      )}
    </div>
  );
}
