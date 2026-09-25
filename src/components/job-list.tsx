"use client";

import { useMemo } from "react";
import { JobCard } from "@/components/job-card";
import { Button } from "@/components/ui/button";
import type { Job } from "@/lib/jobs";

interface JobListProps {
  jobs: Job[];
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onDownloadAll: () => void;
  onClear: () => void;
  /** True while `zipOutputs` is running — disables the button so a second click can't start a second zip. */
  zipping: boolean;
  /** ADR-0008: zips one job's own multiple outputs — passed through to
   * every `JobCard`, see its own doc comment. */
  onDownloadJobOutputs: (id: string) => void;
  zippingJobId: string | null;
}

/**
 * The tracked-jobs panel: one `JobCard` per job, plus the batch actions
 * (download all as a zip, clear). Renders nothing when there are no jobs —
 * the panel only exists once a conversion has been started.
 */
export function JobList({
  jobs,
  onCancel,
  onRemove,
  onDownloadAll,
  onClear,
  zipping,
  onDownloadJobOutputs,
  zippingJobId,
}: JobListProps) {
  const doneCount = jobs.filter((j) => j.status === "done").length;
  const settledCount = jobs.filter((j) =>
    ["done", "error", "cancelled"].includes(j.status),
  ).length;
  const errorCount = jobs.filter((j) => j.status === "error").length;

  // Announced via the live region below — one sentence, only when it changes
  // (settled/error/total counts), so a screen reader isn't interrupted by
  // every 10 Hz progress tick.
  const announcement = useMemo(() => {
    if (settledCount < jobs.length) {
      return `${settledCount} of ${jobs.length} done.`;
    }
    return errorCount > 0
      ? `${doneCount} of ${jobs.length} converted, ${errorCount} failed.`
      : `All ${jobs.length} ${jobs.length === 1 ? "file" : "files"} converted.`;
  }, [jobs.length, settledCount, doneCount, errorCount]);

  if (jobs.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-muted">
          {jobs.length} {jobs.length === 1 ? "file" : "files"}
        </h2>
        <div className="flex gap-2">
          {doneCount >= 2 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDownloadAll}
              disabled={zipping}
            >
              {zipping ? "Zipping…" : "Download all (.zip)"}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onCancel={onCancel}
            onRemove={onRemove}
            onDownloadOutputs={onDownloadJobOutputs}
            zippingId={zippingJobId}
          />
        ))}
      </ul>

      {/* Announces completion counts without visually duplicating the list above. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
