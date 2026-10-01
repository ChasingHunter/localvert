/**
 * ADR-0018: the share-target stash. A share from the Android share sheet is a
 * multipart POST to `/share-target`. The service worker intercepts it (it
 * never reaches the network, see `src/sw.ts`), parks the files here, and
 * redirects to `/open?share=1`, where the page takes them out again.
 *
 * Storage is a dedicated Cache Storage cache on this origin. Entries use
 * synthetic same-origin URLs, with the file name and type kept in headers.
 * The page deletes them as soon as it has read them, and the worker clears
 * any leftovers before writing a new share, so a stash never outlives one
 * handoff for long.
 *
 * Shared by the worker and the page, so: plain DOM types only, no `@/`
 * imports (the worker bundle resolves relative paths only).
 */

export const SHARE_CACHE = "localvert-share-v1";

/** The manifest's `share_target.action`. */
export const SHARE_TARGET_PATH = "/share-target";

/** Path prefix of the synthetic cache keys. Never fetched, never routed. */
const KEY_PREFIX = "/__share/";
const NAME_HEADER = "x-localvert-name";

function keyFor(origin: string, index: number): string {
  return `${origin}${KEY_PREFIX}${index}`;
}

/** The `files` entries of a share-target form, in order, skipping non-files. */
export function filesFromForm(form: FormData): File[] {
  return form.getAll("files").filter((v): v is File => v instanceof File);
}

/** Replaces whatever is stashed with `files`. */
export async function stashSharedFiles(
  caches: CacheStorage,
  origin: string,
  files: readonly File[],
): Promise<void> {
  await caches.delete(SHARE_CACHE);
  const cache = await caches.open(SHARE_CACHE);
  await Promise.all(
    files.map((file, i) =>
      cache.put(
        keyFor(origin, i),
        new Response(file, {
          headers: {
            "content-type": file.type || "application/octet-stream",
            [NAME_HEADER]: encodeURIComponent(file.name),
            "x-localvert-modified": String(file.lastModified),
          },
        }),
      ),
    ),
  );
}

/**
 * Reads every stashed file, then deletes the stash. The bytes are copied out
 * before the delete so the returned `File`s don't depend on cache storage.
 * Returns `[]` when nothing is stashed.
 */
export async function takeSharedFiles(caches: CacheStorage): Promise<File[]> {
  if (!(await caches.has(SHARE_CACHE))) return [];
  const cache = await caches.open(SHARE_CACHE);
  const requests = await cache.keys();
  const ordered = requests
    .map((request) => ({
      request,
      index: Number(new URL(request.url).pathname.slice(KEY_PREFIX.length)),
    }))
    .sort((a, b) => a.index - b.index);

  const files: File[] = [];
  for (const { request } of ordered) {
    const response = await cache.match(request);
    if (!response) continue;
    const name = decodeURIComponent(
      response.headers.get(NAME_HEADER) ?? "shared-file",
    );
    const type = response.headers.get("content-type") ?? "";
    const modified = Number(response.headers.get("x-localvert-modified"));
    files.push(
      new File([await response.arrayBuffer()], name, {
        type: type === "application/octet-stream" ? "" : type,
        lastModified:
          Number.isFinite(modified) && modified > 0 ? modified : Date.now(),
      }),
    );
  }
  await caches.delete(SHARE_CACHE);
  return files;
}
