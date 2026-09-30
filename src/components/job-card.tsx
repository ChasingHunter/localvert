"use client";

import { Trash2Icon, XIcon } from "lucide-react";
import { formatBytes, jobSizeSummary } from "@/components/job-summary";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Job } from "@/lib/jobs";

interface JobCardProps {
  job: Job;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  /** ADR-0008: zips this one job's own `outputs` (one-to-many, e.g.
   * split-pdf) — a *different* zip than `JobList`'s cross-job "download all",
   * scoped to a single job's multiple files. */
  onDownloadOutputs: (id: string) => void;
  /** The id of the job currently being zipped via `onDownloadOutputs`, if
   * any — disables that job's own button so a second click can't start a
   * second zip. */
  zippingId: string | null;
  /** Compress tools: append the saving, "1.2 MB → 557 KB (−54%)". */
  showSaving?: boolean;
}

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Converting…",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

/**
 * One tracked conversion, read straight off the job store — this component
 * never touches the job engine itself, only the two callbacks its parent
 * wires to it.
 */
export function JobCard({
  job,
  onCancel,
  onRemove,
  onDownloadOutputs,
  zippingId,
  showSaving = false,
}: JobCardProps) {
  const cancellable = job.status === "queued" || job.status === "running";

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-ink">
            {job.fileName}
          </span>
          <span className="text-xs text-ink-muted">
            {STATUS_LABEL[job.status]} · {jobSizeSummary(job, showSaving)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {job.status === "done" && job.output && (
            <a
              download={job.output.name}
              href={job.output.url}
              className="inline-flex min-h-9 items-center rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-canvas outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Download
            </a>
          )}
          {job.status === "done" && job.outputs && job.outputs.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => onDownloadOutputs(job.id)}
              disabled={zippingId === job.id}
            >
              {zippingId === job.id ? "Zipping…" : "Download all (.zip)"}
            </Button>
          )}
          {cancellable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={`Cancel ${job.fileName}`}
              onClick={() => onCancel(job.id)}
            >
              <XIcon aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={`Remove ${job.fileName}`}
              onClick={() => onRemove(job.id)}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {cancellable && <Progress value={Math.round(job.progress * 100)} />}

      {job.status === "done" && job.outputs && (
        <ul className="flex flex-col gap-1">
          {job.outputs.map((output) => (
            <li
              key={output.name}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate text-xs text-ink-muted">
                {output.name} · {formatBytes(output.size)}
              </span>
              <a
                download={output.name}
                href={output.url}
                className="shrink-0 text-sm font-medium text-accent hover:underline"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}

      {job.status === "done" && job.output?.note && (
        <p className="text-xs text-ink-muted">{job.output.note}</p>
      )}

      {job.status === "error" && job.error && (
        <p className="text-xs text-danger">{job.error.message}</p>
      )}
    </li>
  );
}
