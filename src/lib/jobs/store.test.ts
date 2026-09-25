import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobStoreState } from "./store";
import {
  createJobStore,
  selectAggregateProgress,
  selectOrderedJobs,
} from "./store";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    toolSlug: "jpg-to-png",
    fileName: "photo.jpg",
    inputSize: 1024,
    inputFormat: "jpg",
    status: "queued",
    progress: 0,
    ...overrides,
  };
}

// Node (>=16.7) carries `URL.createObjectURL`/`revokeObjectURL` natively —
// no browser/jsdom needed — so these can be spied on directly.
beforeEach(() => {
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("createJobStore", () => {
  it("returns an independent store per call", () => {
    const a = createJobStore();
    const b = createJobStore();
    a.getState().add(makeJob());
    expect(a.getState().jobs).toHaveLength(1);
    expect(b.getState().jobs).toHaveLength(0);
  });

  it("add appends in submission order", () => {
    const store = createJobStore();
    store.getState().add(makeJob({ id: "a" }));
    store.getState().add(makeJob({ id: "b" }));
    store.getState().add(makeJob({ id: "c" }));
    expect(store.getState().jobs.map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("update patches only the matching job", () => {
    const store = createJobStore();
    store.getState().add(makeJob({ id: "a", progress: 0 }));
    store.getState().add(makeJob({ id: "b", progress: 0 }));

    store.getState().update("a", { status: "running", progress: 0.5 });

    const [a, b] = store.getState().jobs;
    expect(a).toMatchObject({ id: "a", status: "running", progress: 0.5 });
    expect(b).toMatchObject({ id: "b", status: "queued", progress: 0 });
  });

  it("remove drops the job and revokes its output URL", () => {
    const store = createJobStore();
    store.getState().add(
      makeJob({
        id: "a",
        status: "done",
        output: { name: "out.png", mime: "image/png", size: 1, url: "blob:1" },
      }),
    );
    store.getState().add(makeJob({ id: "b" }));

    store.getState().remove("a");

    expect(store.getState().jobs.map((j) => j.id)).toEqual(["b"]);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:1");
  });

  it("remove without an output does not revoke anything", () => {
    const store = createJobStore();
    store.getState().add(makeJob({ id: "a" }));
    store.getState().remove("a");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("remove revokes every url in a one-to-many job's outputs", () => {
    const store = createJobStore();
    store.getState().add(
      makeJob({
        id: "a",
        status: "done",
        outputs: [
          {
            name: "p1.pdf",
            mime: "application/pdf",
            size: 1,
            url: "blob:1",
            blob: new Blob(),
          },
          {
            name: "p2.pdf",
            mime: "application/pdf",
            size: 1,
            url: "blob:2",
            blob: new Blob(),
          },
        ],
      }),
    );

    store.getState().remove("a");

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:2");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("clear removes every job and revokes every output URL", () => {
    const store = createJobStore();
    store.getState().add(
      makeJob({
        id: "a",
        status: "done",
        output: { name: "a.png", mime: "image/png", size: 1, url: "blob:a" },
      }),
    );
    store.getState().add(
      makeJob({
        id: "b",
        status: "done",
        output: { name: "b.png", mime: "image/png", size: 1, url: "blob:b" },
      }),
    );
    store.getState().add(makeJob({ id: "c" }));

    store.getState().clear();

    expect(store.getState().jobs).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:b");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe("selectOrderedJobs", () => {
  it("returns jobs in submission order", () => {
    const state: JobStoreState = {
      jobs: [makeJob({ id: "a" }), makeJob({ id: "b" })],
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };
    expect(selectOrderedJobs(state).map((j) => j.id)).toEqual(["a", "b"]);
  });
});

describe("selectAggregateProgress", () => {
  it("is 0 with no jobs", () => {
    const state: JobStoreState = {
      jobs: [],
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };
    expect(selectAggregateProgress(state)).toBe(0);
  });

  it("averages progress across every job", () => {
    const state: JobStoreState = {
      jobs: [
        makeJob({ id: "a", progress: 1 }),
        makeJob({ id: "b", progress: 0.5 }),
        makeJob({ id: "c", progress: 0 }),
      ],
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };
    expect(selectAggregateProgress(state)).toBeCloseTo(0.5);
  });
});
