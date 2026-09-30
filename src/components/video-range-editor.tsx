"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  currentEnd,
  formatLength,
  initialRange,
  type RangeKind,
  type RangePatch,
  type RangeResult,
  setEndHere,
  setStartHere,
} from "./video-range-logic";

interface VideoRangeEditorProps {
  file: File;
  kind: RangeKind;
  /** The tool's current option values (start, and end or duration). */
  options: Readonly<Record<string, unknown>>;
  /** Merge these values into the tool's options. */
  onOptionsChange: (patch: RangePatch) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}

/**
 * Preview for Trim Video and Video to GIF: the browser's own `<video
 * controls>` plays the dropped file, and two buttons copy the player's
 * current time into the tool's start/end options. DOM only. The browser
 * decodes for playback, and this code never touches a frame (invariant 2).
 * Like `CropEditor`, it owns no job state, only hands `onSubmit` the go-ahead.
 */
export function VideoRangeEditor({
  file,
  kind,
  options,
  onOptionsChange,
  onSubmit,
  onCancel,
  submitLabel,
}: VideoRangeEditorProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [playable, setPlayable] = useState(true);
  const [message, setMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // A fresh file resets everything derived from the previous one, and the
  // URL is revoked when the file changes or the editor goes away.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setDuration(null);
    setPlayable(true);
    setMessage("");
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    setDuration(video.duration);
    onOptionsChange(initialRange(kind, video.duration));
  }

  function apply(result: RangeResult, done: string) {
    if (result.patch) onOptionsChange(result.patch);
    setMessage(result.message ?? (result.patch ? done : ""));
  }

  function handleSetStart() {
    const video = videoRef.current;
    if (!video) return;
    const limit = duration ?? Number.POSITIVE_INFINITY;
    const result = setStartHere(kind, video.currentTime, options, limit);
    apply(result, `Start set to ${result.patch?.start} s.`);
  }

  function handleSetEnd() {
    const video = videoRef.current;
    if (!video) return;
    const limit = duration ?? Number.POSITIVE_INFINITY;
    const result = setEndHere(kind, video.currentTime, options, limit);
    const end = result.patch
      ? currentEnd(kind, { ...options, ...result.patch }, limit)
      : 0;
    apply(result, `End set to ${Math.round(end * 10) / 10} s.`);
  }

  const start = typeof options.start === "number" ? options.start : 0;
  const end = currentEnd(kind, options, duration ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-full overflow-hidden rounded-2xl border border-border bg-surface p-2">
        {objectUrl && (
          // biome-ignore lint/a11y/useMediaCaption: the user's own clip, played back locally for choosing trim points; there is no caption track to offer.
          <video
            ref={videoRef}
            src={objectUrl}
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onError={() => setPlayable(false)}
            className="block max-h-[60vh] w-full rounded-lg bg-black"
          />
        )}
      </div>

      {!playable && (
        <p className="text-sm text-ink-muted">
          This browser can&apos;t preview this file. You can still set the times
          in the options and run it.
        </p>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {duration !== null && (
          <div className="flex gap-1.5">
            <dt className="text-ink-muted">Length:</dt>
            <dd className="font-medium text-ink">{formatLength(duration)}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="text-ink-muted">Start:</dt>
          <dd className="font-medium text-ink">{start} s</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-ink-muted">End:</dt>
          <dd className="font-medium text-ink">
            {Math.round(end * 10) / 10} s
          </dd>
        </div>
      </dl>

      {playable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={handleSetStart}
          >
            Set start here
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={handleSetEnd}
          >
            Set end here
          </Button>
        </div>
      )}

      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-sm text-ink-muted"
      >
        {message}
      </p>

      <div className="flex items-center gap-2">
        <Button type="button" className="rounded-full" onClick={onSubmit}>
          {submitLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="rounded-full"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
