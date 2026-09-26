/**
 * Opt-in, local-only storage for a single "remembered" signature (ADR-0009:
 * "Saved signature is opt-in and stored only in the user's own IndexedDB,
 * with a 'forget' control. It never leaves the device."). Raw IndexedDB API
 * — no wrapper library, this is one object store with one key.
 *
 * Never localStorage (no size headroom for a PNG, and it's synchronous on
 * the main thread), never network. Every call is wrapped in try/catch:
 * private/incognito mode can make `indexedDB.open` throw or reject
 * synchronously in some browsers, and this feature is optional enough that
 * "acts as if nothing was ever saved" is an acceptable degrade — never an
 * uncaught rejection that breaks the dialog.
 */

const DB_NAME = "localvert";
const DB_VERSION = 1;
const STORE_NAME = "signatures";
const KEY = "default";

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

/** Saves `blob` (the trimmed signature PNG) as the one remembered signature,
 * replacing any previous one. Returns whether it actually saved. */
export async function saveSignature(blob: Blob): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Loads the remembered signature, or `null` if none was saved (or storage
 * is unavailable). */
export async function loadSignature(): Promise<Blob | null> {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(KEY);
      request.onsuccess = () =>
        resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

/** The "forget" control: deletes the remembered signature, if any. */
export async function forgetSignature(): Promise<boolean> {
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
