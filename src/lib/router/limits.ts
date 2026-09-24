import type { Capabilities } from "@/lib/registry";

/**
 * The lazy module worker pool size. Leaves two cores of headroom for the
 * main thread (DOM, object URLs, progress updates) and the browser itself,
 * and caps at 4 so a single conversion doesn't monopolize a high-core-count
 * machine. See ARCHITECTURE.md "Concurrency and memory" — heavy engines
 * (ffmpeg, tesseract, LibreOffice) get a separate pinned worker outside this
 * pool, not a slot in it.
 */
export function defaultPoolSize(caps: Capabilities): number {
  return Math.min(4, Math.max(1, caps.hardwareConcurrency - 2));
}
