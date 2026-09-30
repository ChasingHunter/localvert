/**
 * Pure rules for the trim/GIF preview (`video-range-editor.tsx`): defaults
 * once the duration is known, and what "Set start here" / "Set end here" write
 * into the tool's options. Trim uses `start` + `end`; Video to GIF uses
 * `start` + `duration` (the GIF window is `end - start`).
 */

export type RangeKind = "trim" | "gif";

/** Longest GIF the engine will make, and the tool's own default length. */
export const GIF_MAX_SECONDS = 30;
export const GIF_DEFAULT_SECONDS = 5;
const MIN_CLIP_SECONDS = 0.1;

export type RangePatch = Record<string, number>;

export interface RangeResult {
  /** Option values to merge in, or `null` when nothing should change. */
  patch: RangePatch | null;
  /** Something worth telling the user (announced and shown). */
  message?: string;
}

/** Rounds to 0.1 s, the precision the option fields step in. */
export function roundTenth(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

/** 83 -> "1:23", 3725 -> "1:02:05". */
export function formatLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The option values a freshly loaded video starts from. */
export function initialRange(kind: RangeKind, duration: number): RangePatch {
  if (kind === "trim") {
    return { start: 0, end: Math.max(MIN_CLIP_SECONDS, roundTenth(duration)) };
  }
  return {
    start: 0,
    duration: Math.max(
      MIN_CLIP_SECONDS,
      roundTenth(Math.min(duration, GIF_DEFAULT_SECONDS)),
    ),
  };
}

/** The clip's current end, whichever way the tool stores it. */
export function currentEnd(
  kind: RangeKind,
  options: Readonly<Record<string, unknown>>,
  duration: number,
): number {
  const start = typeof options.start === "number" ? options.start : 0;
  if (kind === "trim") {
    return typeof options.end === "number" ? options.end : duration;
  }
  const length =
    typeof options.duration === "number" ? options.duration : duration;
  return start + length;
}

function gifLength(start: number, end: number): number {
  return Math.min(
    GIF_MAX_SECONDS,
    Math.max(MIN_CLIP_SECONDS, roundTenth(end - start)),
  );
}

/**
 * "Set start here": writes the player's current time (rounded to 0.1 s) as
 * the start. The end stays where it was; if that would leave no clip, it moves
 * to the end of the video.
 */
export function setStartHere(
  kind: RangeKind,
  currentTime: number,
  options: Readonly<Record<string, unknown>>,
  duration: number,
): RangeResult {
  const start = roundTenth(Math.min(Math.max(0, currentTime), duration));
  let end = currentEnd(kind, options, duration);
  if (end - start < MIN_CLIP_SECONDS) end = roundTenth(duration);
  if (end - start < MIN_CLIP_SECONDS) {
    return {
      patch: null,
      message: "Start is too close to the end of the video.",
    };
  }
  if (kind === "trim") return { patch: { start, end } };
  const length = gifLength(start, end);
  return {
    patch: { start, duration: length },
    ...(end - start > GIF_MAX_SECONDS && {
      message: `GIFs are limited to ${GIF_MAX_SECONDS} s, so the end was moved.`,
    }),
  };
}

/** "Set end here": writes the current time (rounded to 0.1 s) as the end. */
export function setEndHere(
  kind: RangeKind,
  currentTime: number,
  options: Readonly<Record<string, unknown>>,
  duration: number,
): RangeResult {
  const start = typeof options.start === "number" ? options.start : 0;
  const end = roundTenth(Math.min(Math.max(0, currentTime), duration));
  if (end - start < MIN_CLIP_SECONDS) {
    return {
      patch: null,
      message: "The end has to come after the start.",
    };
  }
  if (kind === "trim") return { patch: { end } };
  return {
    patch: { duration: gifLength(start, end) },
    ...(end - start > GIF_MAX_SECONDS && {
      message: `GIFs are limited to ${GIF_MAX_SECONDS} s, so the clip was cut short.`,
    }),
  };
}
