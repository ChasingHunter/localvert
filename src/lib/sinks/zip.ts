import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { sanitizeEntryName, uniqueName } from "./names";

export interface ZipEntry {
  name: string;
  data: Blob | ArrayBuffer | ReadableStream<Uint8Array>;
  /** Deflate at level 6 when true; store uncompressed (fflate's
   * `ZipPassThrough`) when false or omitted — the default, since most of
   * what this app produces (jpeg, mp4, already-deflated formats) doesn't
   * compress further and paying the CPU cost for it is wasted work. */
  compress?: boolean;
}

export interface ZipSink {
  /** The `.zip` bytes, in archive order. Nothing is produced until a
   * consumer starts reading — see `createZipSink`'s backpressure note. */
  readonly stream: ReadableStream<Uint8Array>;
  /** Resolves once `entry` has been fully read and written into the
   * archive. Calls are serialized internally (see `createZipSink`), so it
   * is safe to call this repeatedly without awaiting each call. */
  add(entry: ZipEntry): Promise<void>;
  /** Writes the central directory and closes `stream`. Safe to call with
   * zero entries added — that produces a valid, empty zip. */
  finish(): Promise<void>;
  /** Errors `stream` immediately. Any `add()`/`finish()` already in flight,
   * and any called afterwards, reject with `reason`. */
  abort(reason?: unknown): void;
}

/** fflate's ZIP writer does not implement ZIP64: entry and archive sizes
 * are 32-bit fields, so any single entry (or the archive as a whole) is
 * limited to 4 GiB. Fine for Localvert's per-file conversions today; worth
 * revisiting if an engine ever produces something close to that. */
const DEFAULT_HIGH_WATER_MARK_BYTES = 8 * 1024 * 1024;
const DEFLATE_LEVEL = 6;

interface ByteReader {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
}

/** Normalizes any of the three `ZipEntry.data` shapes to a single
 * chunk-at-a-time reader, so the add loop below doesn't need to care which
 * one it got. */
function readerFor(data: ZipEntry["data"]): ByteReader {
  if (data instanceof ArrayBuffer) {
    let done = false;
    return {
      async read() {
        if (done) return { done: true, value: undefined };
        done = true;
        return { done: false, value: new Uint8Array(data) };
      },
    };
  }
  const stream = data instanceof ReadableStream ? data : data.stream();
  return stream.getReader();
}

/**
 * Builds a streaming zip: bytes come out of `.stream` as entries are added,
 * so a batch never sits fully in memory — peak memory is roughly one entry,
 * not the whole archive.
 *
 * BACKPRESSURE: `.stream` uses a byte-length queuing strategy with
 * `highWaterMarkBytes` (default 8 MiB) as its high water mark. While the
 * consumer of `.stream` is behind (`controller.desiredSize <= 0`), `add()`
 * stops pulling further chunks from the *current* entry's source — it does
 * not buffer them. This matters because fflate's `Zip` is push-based (it
 * hands us compressed bytes synchronously as we feed it), so without an
 * explicit gate here, a caller that adds a large entry and never reads
 * `.stream` would have that entire entry decoded into memory while it
 * waits to be read. Gating *before* each read from the entry's own source
 * keeps a stalled consumer from costing more than one in-flight chunk.
 */
export function createZipSink(opts?: { highWaterMarkBytes?: number }): ZipSink {
  const highWaterMark =
    opts?.highWaterMarkBytes ?? DEFAULT_HIGH_WATER_MARK_BYTES;

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let pullWaiter: (() => void) | null = null;
  let aborted = false;
  let abortReason: unknown;

  let resolveClosed!: () => void;
  let rejectClosed!: (reason: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  // Nothing observes `closed` rejecting unless abort() happens mid-finish();
  // avoid an unhandled-rejection warning in that common case.
  closed.catch(() => {});

  function wake() {
    if (!pullWaiter) return;
    const resolve = pullWaiter;
    pullWaiter = null;
    resolve();
  }

  function doAbort(reason: unknown) {
    if (aborted) return;
    aborted = true;
    abortReason = reason ?? new Error("ZipSink aborted");
    rejectClosed(abortReason);
    wake();
    try {
      controller.error(abortReason);
    } catch {
      // stream already closed/errored — fine, that's the state we wanted.
    }
  }

  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
      },
      pull() {
        // The consumer just made room. Wake a paused add() so it resumes
        // reading its entry instead of stalling forever.
        wake();
      },
      cancel(reason) {
        doAbort(reason);
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark }),
  );

  /** Resolves once there's room in `stream`'s queue, or immediately if the
   * sink is already aborted (callers must re-check `aborted` afterwards —
   * this is a wake-up, not a guarantee of anything else). */
  function waitForCapacity(): Promise<void> {
    if (aborted) return Promise.resolve();
    if ((controller.desiredSize ?? 1) > 0) return Promise.resolve();
    return new Promise((resolve) => {
      pullWaiter = resolve;
    });
  }

  const zip = new Zip((err, data, final) => {
    if (err) {
      doAbort(err);
      return;
    }
    if (data.length > 0) controller.enqueue(data);
    if (final) {
      try {
        controller.close();
      } catch {
        // already errored by an abort racing the final chunk — fine.
      }
      resolveClosed();
    }
  });

  const taken = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  let finished = false;

  function checkOpen() {
    if (aborted) throw abortReason;
    if (finished) throw new Error("ZipSink: already finished");
  }

  async function writeEntry(entry: ZipEntry): Promise<void> {
    const name = uniqueName(taken, sanitizeEntryName(entry.name));
    const file = entry.compress
      ? new ZipDeflate(name, { level: DEFLATE_LEVEL })
      : new ZipPassThrough(name);
    zip.add(file);

    const reader = readerFor(entry.data);
    for (;;) {
      // Gate *before* pulling the next chunk — see the backpressure note
      // on createZipSink.
      await waitForCapacity();
      if (aborted) throw abortReason;
      const { done, value } = await reader.read();
      if (done) break;
      file.push(value, false);
    }
    file.push(new Uint8Array(0), true);
  }

  function add(entry: ZipEntry): Promise<void> {
    const task = queue.then(async () => {
      checkOpen();
      await writeEntry(entry);
    });
    // Keep the chain alive even if this entry rejected, so entries queued
    // after it still run (and see `aborted`/`finished` promptly) instead of
    // hanging behind a rejected link forever.
    queue = task.catch(() => {});
    return task;
  }

  function finish(): Promise<void> {
    const task = queue.then(async () => {
      checkOpen();
      finished = true;
      zip.end();
      await closed;
    });
    queue = task.catch(() => {});
    return task;
  }

  function abort(reason?: unknown): void {
    doAbort(reason);
  }

  return { stream, add, finish, abort };
}
