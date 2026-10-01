"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { engineDisplayName } from "@/lib/engines/display-names";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { formatBytes } from "@/lib/engines/shared/format-bytes";
import {
  deleteEngineCache,
  deleteEngineEntries,
  listEngineEntries,
} from "@/lib/storage/engine-cache";
import {
  clearEngineConsent,
  type EngineRow,
  groupEngineEntries,
} from "@/lib/storage/engines";

interface Usage {
  used: number;
  quota: number;
}

async function readUsage(): Promise<Usage | null> {
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return usage === undefined || quota === undefined
      ? null
      : { used: usage, quota };
  } catch {
    return null;
  }
}

/** Client island: reads the engine cache and storage estimate, offers removal. */
export function StoragePanel() {
  const [rows, setRows] = useState<EngineRow[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [status, setStatus] = useState("");
  const [persistNote, setPersistNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const entries = await listEngineEntries();
      setRows(groupEngineEntries(entries, ENGINE_MANIFEST, engineDisplayName));
    } catch {
      setRows([]);
    }
    setUsage(await readUsage());
  }, []);

  useEffect(() => {
    void refresh();
    const storage = navigator.storage;
    if (typeof storage?.persisted === "function") {
      storage
        .persisted()
        .then(setPersisted)
        .catch(() => {});
    }
  }, [refresh]);

  async function remove(targets: EngineRow[] | "all") {
    if (targets === "all") {
      await deleteEngineCache();
      clearEngineConsent(window.localStorage);
    } else {
      await deleteEngineEntries(targets.flatMap((r) => r.urls));
      for (const row of targets) {
        clearEngineConsent(window.localStorage, row.id);
      }
    }
    const freed = (targets === "all" ? (rows ?? []) : targets).reduce(
      (sum, r) => sum + r.bytes,
      0,
    );
    await refresh();
    setStatus(`Removed. ${formatBytes(freed)} freed.`);
  }

  async function keepDownloads() {
    try {
      const granted = await navigator.storage.persist();
      setPersisted(granted);
      setPersistNote(
        granted
          ? "Done. Your browser will keep them."
          : "Your browser said no. It may clear them if space runs low.",
      );
    } catch {
      setPersistNote("Your browser said no.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-ink">
        {usage
          ? `Using ${formatBytes(usage.used)} of about ${formatBytes(usage.quota)} available`
          : "Checking how much space is in use..."}
      </p>

      {rows === null ? null : rows.length === 0 ? (
        <p className="text-ink-muted">
          Nothing downloaded yet. Converters download the first time you use
          them.
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {rows.map((row) => (
              <li
                key={`${row.id}@${row.version}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium text-ink">
                    {row.name}
                    {row.old ? (
                      <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal text-ink-muted">
                        Old version
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm text-ink-muted">
                    {formatBytes(row.bytes)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  aria-label={`Remove ${row.name}${row.old ? ` (old version ${row.version})` : ""}`}
                  onClick={() => void remove([row])}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void remove("all")}
            >
              Remove all downloads
            </Button>
          </div>
        </>
      )}

      {persisted === false || persistNote ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="outline"
            className="min-h-11 h-auto whitespace-normal text-left"
            onClick={() => void keepDownloads()}
          >
            Keep downloads even when your device is low on space
          </Button>
          <p role="status" className="text-sm text-ink-muted">
            {persistNote}
          </p>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="text-sm text-ink-muted">
        {status}
      </p>
    </div>
  );
}
