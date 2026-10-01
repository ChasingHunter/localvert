/**
 * Pure logic behind the /storage page: which downloaded engine does a cached
 * URL belong to, and how do the cache's entries roll up into one row per
 * engine version. No DOM, no Cache API (see `engine-cache.ts` for that).
 */
import { CONSENT_KEY_PREFIX } from "@/lib/engines/consent";

/** One cached file: its pathname-bearing URL and its size in bytes. */
export interface CachedEntry {
  url: string;
  bytes: number;
}

export interface EngineRow {
  id: string;
  version: string;
  name: string;
  bytes: number;
  /** Cache keys (URLs) to delete when this row is removed. */
  urls: string[];
  /** The current manifest ships a different version of this engine. */
  old: boolean;
}

/** `/engines/<id>--<version>/...` or `/engines/xl/<id>--<version>/...`. */
const ENGINE_PATH = /^\/engines\/(?:xl\/)?([^/]+?)--([^/]+)\//;

/** Engine id and version from a cached URL, or null if it isn't an engine path. */
export function parseEngineUrl(
  url: string,
): { id: string; version: string } | null {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
  const match = ENGINE_PATH.exec(pathname);
  return match?.[1] && match[2] ? { id: match[1], version: match[2] } : null;
}

/**
 * One row per `<id>--<version>`, biggest first. An id the manifest no longer
 * knows keeps its raw id as the name and is not flagged old (nothing newer
 * exists to point at).
 */
export function groupEngineEntries(
  entries: readonly CachedEntry[],
  manifest: Readonly<Record<string, { version: string }>>,
  displayName: (id: string) => string,
): EngineRow[] {
  const rows = new Map<string, EngineRow>();
  for (const entry of entries) {
    const parsed = parseEngineUrl(entry.url);
    if (!parsed) continue;
    const key = `${parsed.id}@${parsed.version}`;
    let row = rows.get(key);
    if (!row) {
      const current = manifest[parsed.id]?.version;
      row = {
        id: parsed.id,
        version: parsed.version,
        name: displayName(parsed.id),
        bytes: 0,
        urls: [],
        old: current !== undefined && current !== parsed.version,
      };
      rows.set(key, row);
    }
    row.bytes += entry.bytes;
    row.urls.push(entry.url);
  }
  return [...rows.values()].sort((a, b) => b.bytes - a.bytes);
}

/** The slice of `Storage` needed to find and delete consent keys. */
export interface KeyedStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/**
 * Forgets the stored download consent, for every version of `id` (or every
 * engine when `id` is omitted), so the consent dialog asks again. Never
 * throws: a blocked `localStorage` just means nothing was remembered.
 */
export function clearEngineConsent(storage: KeyedStorage, id?: string): void {
  const prefix =
    id === undefined ? CONSENT_KEY_PREFIX : `${CONSENT_KEY_PREFIX}${id}@`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing remembered, nothing to clear.
  }
}
