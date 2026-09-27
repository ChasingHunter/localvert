# ADR-0010: Media pipeline on mediabunny, with OPFS-backed outputs

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Phase 3 adds video and audio conversion. Unlike the image pipeline (ADR-0007),
media files are large — a source video can be hundreds of MB to several GB —
and cannot be read whole into a worker's heap, encoded whole, and handed back
as one in-memory `Blob` the way a raster image can.

`mediabunny` is the library already named across ADR-0002 as the primary video
and audio path: it wraps WebCodecs (native decode/encode, no wasm codec of its
own for the common containers) with container muxing/demuxing for mp4, webm,
mov, mp3, wav and others. Two things about it matter for this ADR:

- Its `Source` classes (`BlobSource`, `UrlSource`, `StreamSource`, …) read
  input incrementally — a `BlobSource` wraps a `Blob`/`File` and only pulls
  the byte ranges the demuxer asks for, via `Blob.slice()` + `arrayBuffer()`.
  Passing it the dropped `File` directly means mediabunny never holds the
  whole input in memory, matching how inputs already arrive at the engine
  (`{kind:"blob"}`, disk-backed, per `job-engine.ts`).
- Its `Target` classes are symmetric: `BufferTarget` accumulates the whole
  output in memory (fine for small files, unworkable for a multi-hundred-MB
  transcode), while `StreamTarget` takes a `WritableStream<StreamTargetChunk>`
  and writes each muxed chunk as it's produced, at the position mediabunny
  gives it (containers seek backward to patch box sizes/lengths, so writes
  are non-sequential — this is the reason for the `position` field on every
  chunk).

The engine adapter contract (`src/lib/engines/types.ts`) already has
`EngineResult` kinds `"stream"` and `"opfs"` (line ~111-113) and
`engine-host.ts` already forwards an `"opfs"` result across the worker
boundary (line ~118) — added ahead of any engine that needed them. The
consumer, `job-engine.ts:326`, still rejects `"opfs"` results
("OPFS outputs are not supported yet"). This ADR is also what closes that gap.

## Decision

**Input:** `mediabunny.Input` over a `mediabunny.BlobSource` wrapping the
task's `File` directly. No full read; mediabunny slices the file as its
demuxer needs bytes.

**Output:** the worker's `Origin Private File System` (OPFS) is the primary
target, because it's the only browser storage a dedicated worker can write to
**synchronously** and at arbitrary offsets, which is what a muxer's
backward-seeking writes need without buffering the whole output first:

1. `navigator.storage.getDirectory()` → a `/localvert-tmp/` subdirectory →
   `getFileHandle(name, {create: true})` → `createSyncAccessHandle()`. This
   handle is **dedicated-worker-only** (not available on the main thread or in
   a shared/service worker), which is fine — invariant 2 already confines
   decode/encode/mux to a worker.
2. A small `WritableStream<StreamTargetChunk>` adapter whose `write(chunk)`
   calls `handle.write(chunk.data, {at: chunk.position})`, backing
   `mediabunny.StreamTarget`. `close()` calls `handle.flush()` then
   `handle.close()`.
3. The adapter returns `{kind: "opfs", path, size, mime}` — `path` is the
   `/localvert-tmp/<job-id>.<ext>` name the handle was opened under, `size` is
   read back from the closed file, `mime` is the output format's registry
   entry.
4. **Fallback** when OPFS is unavailable (probed via
   `"getDirectory" in navigator.storage`, e.g. in whatever browsers still lack
   it, or a private-browsing mode that disables it): `BufferTarget`,
   in-memory, returning `{kind: "bytes", ...}`. Capped at 300 MB output — past
   that the job fails with a clear "output too large for this browser; try a
   browser with OPFS support" `EngineError`, rather than risking an OOM on a
   multi-GB accumulation.

**Capability probe:** before running, the adapter calls mediabunny's
`canEncodeVideo`/`canEncodeAudio` (or the lower-level WebCodecs
`VideoEncoder.isConfigSupported`/`AudioEncoder.isConfigSupported` mediabunny
wraps) for the candidate codec, and picks the first one the browser actually
supports — VP9 first, falling back to VP8, for webm video; Opus for its
audio track. If none of the candidates probe positive, the job fails up front
with "your browser can't encode video/webm" rather than an opaque failure
partway through a long transcode.

**Conversion:** the `mediabunny.Conversion` class (`Conversion.init({input,
output})`, then `.execute()`) drives demux → decode → (re-encode if the
container/codec pair requires it) → mux in one call, and exposes
`onProgress`/an `AbortSignal` hook — wired to the engine task's `signal` and
`onProgress` exactly like every other engine.

**Cleanup:** OPFS temp files under `/localvert-tmp/` are owned by the job that
created them. `job-engine.ts` deletes the file when that job's output is
dismissed or replaced (same lifecycle as revoking an object URL for a `Blob`
result today). Because a crash or a closed tab can strand a file, the app
shell also sweeps `/localvert-tmp/` on startup and deletes anything older than
24 h (checked via `File.lastModified`) — cheap, since it only lists a directory
of at most a few pending jobs' temp files, and it runs once per app load, not
per job.

**Main thread:** never reads OPFS file contents into memory (invariant 2 is
about decode/encode, but the same reasoning applies to "streaming a large file
through JS on the UI thread"). It gets the `File` back via
`getDirectory()` → `getFileHandle(path)` → `getFile()` (a disk-backed `Blob`,
just like the `Blob` outputs already handled), and treats it identically:
object URL for preview/download, `.size`/`.name` for the job list, and as an
input to the zip / File System Access sinks.

**License correction:** ADR-0002's table lists mediabunny as MIT. The
installed 1.60.0 is **MPL-2.0** (file-level copyleft, same shape as `resvg`,
already in `THIRD_PARTY_LICENSES.md`) — corrected there and in this ADR's own
reference. `@mediabunny/mp3-encoder` (a LAME wasm build under MPL-2.0
wrapper, LAME itself LGPL) is installed for a future audio slice and not
wired into any tool yet.

## Consequences

**What it buys**

- Handles the actual size regime of video files without buffering a whole
  transcode in the worker heap or the main thread.
- `job-engine.ts`'s `"opfs"` rejection was a placeholder, not a design
  decision — closing it here means the next media/large-output engine (audio,
  future archive streaming) doesn't have to re-litigate the same plumbing.
- OPFS temp files are swept on two independent triggers (job dismissal,
  startup sweep), so a crash mid-job doesn't leak disk quota forever.

**What it costs**

- OPFS's `FileSystemSyncAccessHandle` is worker-only and Chromium/Firefox
  recent-only; the `BufferTarget` fallback exists but caps output size, so a
  handful of older/private-mode sessions get a worse ceiling on large video
  jobs than Chromium users do.
- `StreamTarget`'s non-sequential writes mean the adapter can't just pipe to
  a `WritableStream` backed by the File System Access API's own
  `createWritable()` (that stream only supports sequential appends per its
  spec) — OPFS's sync access handle's `write(data, {at})` is what makes
  backward-seeking mux writes possible at all.
- The main thread now holds OPFS file handles it must remember to close/
  delete; a leaked handle-to-delete mapping is a new class of bug this ADR's
  cleanup triggers exist to bound.

## Alternatives considered

**`BufferTarget` for everything, no OPFS.** Rejected: multi-hundred-MB to
multi-GB video output held entirely in a worker's heap risks OOM on exactly
the files users most want to convert (long video). This is the gap this ADR
exists to close.

**File System Access API (`showSaveFilePicker` → `createWritable()`) as the
primary target instead of OPFS.** Rejected as primary: it requires a user
gesture and a picker per job, which doesn't fit the existing job-queue flow
(pick once, run many, review results, then choose to keep or discard). OPFS
stays invisible until the user asks to save, matching how `Blob` outputs work
today. File System Access remains a **sink** option once a result exists (see
`src/lib/sinks`), unchanged by this ADR.

**Re-mux without re-encode when the input codec is already acceptable in the
output container.** Real optimization (mediabunny's `Conversion` supports it),
but out of scope for this ADR — the first tool (`mp4-to-webm`) always crosses
a codec boundary (h264/aac → vp8-or-9/opus), so there's no case to exercise it
yet. Left for whenever a same-codec repackaging tool is added.
