/**
 * The editor's one local IndexedDB database ("localvert"), shared by the
 * saved-signature store and the draft store. Every store is created here, in
 * one upgrade handler: with per-file handlers, whichever store opened the
 * database first at a given version was the only one created, and the other
 * silently failed every read and write from then on.
 *
 * Bump `LOCAL_DB_VERSION` and add the store name to `LOCAL_DB_STORES` when
 * adding a store — never open the database anywhere else.
 */

const LOCAL_DB_NAME = "localvert";
const LOCAL_DB_VERSION = 2;

export const LOCAL_DB_STORES = ["signatures", "drafts"] as const;
export type LocalDbStore = (typeof LOCAL_DB_STORES)[number];

export function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of LOCAL_DB_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
