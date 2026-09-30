/**
 * Checks a requested clip against the real length of the video. Pure, so it
 * is unit-testable without mediabunny. `trim-video` and `video-to-gif` both
 * use it.
 *
 * A start at or past the end of the video can only produce an empty file, so
 * it fails with a plain message. An end past the end is harmless and is
 * clamped silently. When the duration is unknown the range is left alone.
 */

export type ClipRange =
  | { ok: true; start: number; end: number | undefined }
  | { ok: false; message: string };

/** 12.34 -> "12.3", 50 -> "50". */
export function formatSeconds(seconds: number): string {
  return String(Number(seconds.toFixed(1)));
}

export function fitClipToDuration(
  start: number,
  end: number | undefined,
  duration: number | undefined,
): ClipRange {
  if (duration === undefined || !(duration > 0)) {
    return { ok: true, start, end };
  }
  if (start >= duration) {
    return {
      ok: false,
      message: `Start (${formatSeconds(start)} s) is after the end of the video (${formatSeconds(duration)} s).`,
    };
  }
  return {
    ok: true,
    start,
    end: end === undefined ? undefined : Math.min(end, duration),
  };
}
