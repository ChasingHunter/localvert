/**
 * Opt-in, local-only autosave for the PDF editor (E6b). One object store,
 * one record: the exported bytes of the document currently open, saved every
 * 30s while "Keep a local draft" is on (see `pdf-editor-app.tsx`'s
 * `useDraftAutosave`). Raw IndexedDB API, same shape as `signature-store.ts`
 * — no wrapper library, every call wrapped in try/catch (private/incognito
 * mode, quota errors, etc. all degrade to "acts as if no draft exists" rather
 * than an uncaught rejection).
 *
 * Shares the "localvert" database with `signature-store.ts`. `DB_VERSION` is
 * bumped here (and in that file, to match) so this store's
 * `onupgradeneeded` actually runs for anyone who already has the database at
 * version 1 — `indexedDB.open` throws `VersionError` if a later caller ever
 * asks for a version lower than what's on disk, so the two files' versions
 * must never drift apart.
 *
 * Never sent over the network — this file has no `fetch`/`XMLHttpRequest`
 * call, only `indexedDB`.
 */

const DB_NAME = "localvert";
const DB_VERSION = 2;
const STORE_NAME = "drafts";
const KEY = "pdf-editor";

/** The record stored for the one remembered draft. `bytes` is the exported
 * PDF's raw bytes (a fresh `ArrayBuffer` each save, never a view aliasing
 * anything the editor still holds). */
export interface DraftRecord {
  name: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

/** True if `value` is a well-formed `DraftRecord` — guards against a
 * partially-written or foreign-shaped record ever reaching the restore
 * banner (e.g. a future schema change, or IndexedDB returning `undefined`
 * for a missing key). */
export function isValidDraftRecord(value: unknown): value is DraftRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    v.name.length > 0 &&
    v.bytes instanceof ArrayBuffer &&
    typeof v.savedAt === "number" &&
    Number.isFinite(v.savedAt)
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Saves `record` as the one remembered draft, replacing any previous one.
 * Returns whether it actually saved. */
export async function saveDraft(record: DraftRecord): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Loads the remembered draft, or `null` if none was saved (or storage is
 * unavailable, or the stored value is malformed). */
export async function loadDraft(): Promise<DraftRecord | null> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return isValidDraftRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Deletes the remembered draft, if any — called when the "Keep a local
 * draft" switch is turned off. */
export async function deleteDraft(): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Formats `fromMs` relative to `nowMs` (defaults to `Date.now()`) as a short
 * phrase for the restore banner — "just now", "5m ago", "2h ago", "3d ago".
 * A pure function so it's unit-testable without mocking the clock globally. */
export function formatRelativeTime(fromMs: number, nowMs = Date.now()): string {
  const diffSec = Math.round((nowMs - fromMs) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}
