import { create } from "zustand";
import type { EngineErrorCode } from "@/lib/engines";
import type { FormatId } from "@/lib/registry";

/**
 * MAIN THREAD. One conversion job, as tracked by the UI — not to be
 * confused with `RunRequest` (`src/lib/workers/protocol.ts`), which is what
 * actually crosses the worker boundary. `job-engine.ts` is the only writer;
 * everything else (components, this file's own selectors) only reads.
 */
export interface Job {
  id: string;
  toolSlug: string;
  fileName: string;
  inputSize: number;
  inputFormat: FormatId;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  /** 0..1. */
  progress: number;
  error?: { code: EngineErrorCode; message: string };
  /** One-to-one and many-to-one jobs (ADR-0008): a single output file. */
  output?: { name: string; mime: string; size: number; url: string };
  /** One-to-many jobs (ADR-0008, e.g. `split-pdf`): every output file, in
   * the order the engine produced them. `blob` rides alongside `url` so the
   * job card's per-job "Download all (.zip)" can hand the zip sink real
   * bytes without re-fetching the object URL — same reasoning as
   * `job-engine.ts`'s own `outputBlobs` map for the single-output case. */
  outputs?: {
    name: string;
    mime: string;
    size: number;
    url: string;
    blob: Blob;
  }[];
}

export interface JobStoreState {
  /** Insertion order — the order jobs were submitted in. */
  jobs: Job[];
  add(job: Job): void;
  update(id: string, patch: Partial<Job>): void;
  /** Removes the job and revokes its output's object URL, if it has one. */
  remove(id: string): void;
  /** Removes every job, revoking all of their output object URLs. */
  clear(): void;
}

/**
 * A fresh, independent store — tests get their own instead of sharing
 * `jobStore`'s module-level state. The default export for actual app code is
 * `jobStore` below.
 */
export function createJobStore() {
  return create<JobStoreState>()((set, get) => ({
    jobs: [],
    add(job) {
      set((state) => ({ jobs: [...state.jobs, job] }));
    },
    update(id, patch) {
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? { ...job, ...patch } : job,
        ),
      }));
    },
    remove(id) {
      const job = get().jobs.find((j) => j.id === id);
      if (job?.output) URL.revokeObjectURL(job.output.url);
      for (const output of job?.outputs ?? []) URL.revokeObjectURL(output.url);
      set((state) => ({ jobs: state.jobs.filter((j) => j.id !== id) }));
    },
    clear() {
      for (const job of get().jobs) {
        if (job.output) URL.revokeObjectURL(job.output.url);
        for (const output of job.outputs ?? []) URL.revokeObjectURL(output.url);
      }
      set({ jobs: [] });
    },
  }));
}

export type JobStore = ReturnType<typeof createJobStore>;

/** The store the app actually uses — a React hook, and (via `.getState()`
 * etc.) the imperative handle `job-engine.ts` writes through. */
export const jobStore = createJobStore();

/** Jobs in submission order — the order the UI lists them in. */
export function selectOrderedJobs(state: JobStoreState): Job[] {
  return state.jobs;
}

/** Mean progress across every tracked job, 0 when there are none. */
export function selectAggregateProgress(state: JobStoreState): number {
  if (state.jobs.length === 0) return 0;
  const total = state.jobs.reduce((sum, job) => sum + job.progress, 0);
  return total / state.jobs.length;
}
