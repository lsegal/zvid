import { useCallback, useEffect, useState } from "react";
import {
  getMediaStorageStatus,
  type MediaStorageStatus,
  removeCachedMedia,
} from "../media-cache";
import {
  formatBytes,
  type StoragePersistence,
  summarizeSessionUsage,
} from "../storage-manager";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type MediaStorageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with media whose cached copy was removed while the open session
  // was still reading it, so those items can be marked offline.
  onCleared: (invalidatedIds: string[], clearedCount: number) => void;
};

const PERSISTENCE_LABELS: Record<StoragePersistence, string> = {
  persistent: "Persistent",
  "best-effort": "May be cleared by the browser",
  unsupported: "May be cleared by the browser",
};

const PERSISTENCE_DETAILS: Record<StoragePersistence, string> = {
  persistent: "The browser won't clear cached media to free up space.",
  "best-effort":
    "The browser can clear cached media when the device runs low on space.",
  unsupported: "This browser can't make storage persistent.",
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Shows how much browser storage cached media uses, whether the browser may
 * clear it, and lets the user free space from other sessions or all of it.
 */
export function MediaStorageDialog({
  open,
  onOpenChange,
  onCleared,
}: MediaStorageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="offline-media-dialog media-storage-dialog">
        {open ? <MediaStorageDialogBody onCleared={onCleared} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MediaStorageDialogBody({
  onCleared,
}: Pick<MediaStorageDialogProps, "onCleared">) {
  const [status, setStatus] = useState<MediaStorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getMediaStorageStatus());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function clear(ids: string[]) {
    setConfirmClearAll(false);
    setIsBusy(true);
    try {
      onCleared(await removeCachedMedia(ids), ids.length);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsBusy(false);
      await refresh();
    }
  }

  const records = status?.records ?? [];
  const referencedIds = status?.referencedIds ?? new Set<string>();
  const session = status?.session || "This session";
  const usage = summarizeSessionUsage(records, session, referencedIds);
  const cachedBytes = records.reduce((total, record) => total + record.size, 0);
  const otherIds = records
    .filter((record) => !referencedIds.has(record.id))
    .map((record) => record.id);
  const estimate = status?.estimate ?? null;
  const percent = estimate
    ? Math.min(100, Math.round((estimate.usage / estimate.quota) * 100))
    : 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Media Storage</DialogTitle>
        <DialogDescription>
          Media is cached in this browser so sessions reopen without relinking
          files.
        </DialogDescription>
      </DialogHeader>

      {error ? (
        <div className="offline-media__banner offline-media__banner--warning">
          <p>{`Storage unavailable: ${error}`}</p>
        </div>
      ) : null}

      {status ? (
        <dl className="media-storage__summary">
          <div>
            <dt>Storage</dt>
            <dd
              className={`media-storage__persistence media-storage__persistence--${status.persistence}`}
              title={PERSISTENCE_DETAILS[status.persistence]}
            >
              {PERSISTENCE_LABELS[status.persistence]}
            </dd>
          </div>
          <div>
            <dt>Used</dt>
            <dd>
              {estimate
                ? `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`
                : "Unknown"}
            </dd>
          </div>
          <div>
            <dt>Cached media</dt>
            <dd>
              {`${formatBytes(cachedBytes)} · ${pluralize(records.length, "file")}`}
            </dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>
              {status.backend === "opfs"
                ? "Origin private file system"
                : "IndexedDB"}
            </dd>
          </div>
        </dl>
      ) : null}

      {estimate ? (
        <div
          aria-label="Browser storage used"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          className="media-sync-dialog__bar media-sync-dialog__bar--overall"
          role="progressbar"
        >
          <span
            className="media-sync-dialog__bar-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}

      {usage.length ? (
        <ul className="offline-media__list">
          {usage.map((entry) => (
            <li className="offline-media__row" key={entry.session}>
              <div className="offline-media__info">
                <strong className="offline-media__name" title={entry.session}>
                  {entry.session}
                </strong>
                <small className="offline-media__usage">
                  {entry.current
                    ? `Open now · ${pluralize(entry.count, "file")}`
                    : pluralize(entry.count, "file")}
                </small>
              </div>
              <span className="media-storage__bytes">
                {formatBytes(entry.bytes)}
              </span>
            </li>
          ))}
        </ul>
      ) : status ? (
        <p className="media-storage__empty">No media is cached.</p>
      ) : null}

      {confirmClearAll ? (
        <div className="offline-media__confirm">
          <span>
            Clear all cached media? Files in the open session will need
            relinking.
          </span>
          <button
            className="ghost-button ghost-button--accent"
            disabled={isBusy}
            onClick={() => void clear(records.map((record) => record.id))}
            type="button"
          >
            Clear all
          </button>
          <button
            className="ghost-button"
            onClick={() => setConfirmClearAll(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : null}

      <DialogFooter className="offline-media__footer">
        <button
          className="ghost-button"
          disabled={isBusy || !otherIds.length}
          onClick={() => void clear(otherIds)}
          type="button"
        >
          Clear cached media for other sessions
        </button>
        <button
          className="ghost-button"
          disabled={isBusy || !records.length}
          onClick={() => setConfirmClearAll(true)}
          type="button"
        >
          Clear all
        </button>
        <DialogClose asChild>
          <button className="ghost-button ghost-button--accent" type="button">
            Close
          </button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}
