"use client";

import { Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Job } from "@/lib/jobs";

interface JobCardProps {
  job: Job;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Converting…",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

/** `1536` -> "1.5 KB". Matches the precision the download link's size needs, no more. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * One tracked conversion, read straight off the job store — this component
 * never touches the job engine itself, only the two callbacks its parent
 * wires to it.
 */
export function JobCard({ job, onCancel, onRemove }: JobCardProps) {
  const cancellable = job.status === "queued" || job.status === "running";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-ink">
            {job.fileName}
          </span>
          <span className="text-xs text-ink-muted">
            {STATUS_LABEL[job.status]} · {formatBytes(job.inputSize)}
            {job.output && ` → ${formatBytes(job.output.size)}`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {job.status === "done" && job.output && (
            <a
              download={job.output.name}
              href={job.output.url}
              className="text-sm font-medium text-accent hover:underline"
            >
              Download
            </a>
          )}
          {cancellable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
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
              aria-label={`Remove ${job.fileName}`}
              onClick={() => onRemove(job.id)}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {cancellable && <Progress value={Math.round(job.progress * 100)} />}

      {job.status === "error" && job.error && (
        <p className="text-xs text-danger">{job.error.message}</p>
      )}
    </li>
  );
}
