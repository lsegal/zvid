import { useState } from "react";
import {
  type MediaRelinkCandidate,
  pickRelinkCandidates,
} from "../media-relink";
import {
  formatMegabytes,
  type MediaSyncEntry,
  type MediaSyncRole,
  type MediaSyncState,
  type MediaSyncSummary,
  mediaSyncFraction,
} from "../media-sync";
import {
  forcedRelinkWarning,
  mediaDisplayName,
  type RelinkReport,
  relinkCandidateFile,
} from "../relink";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export type MediaSyncPeer = { name: string; color: string };

type PendingForcedLink = {
  itemId: string;
  candidate: MediaRelinkCandidate;
};

type MediaSyncDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: MediaSyncEntry[];
  summary: MediaSyncSummary;
  // The collaborator media comes from, when there is only one.
  peer?: MediaSyncPeer;
  relinkingIds: ReadonlySet<string>;
  retryMedia: (mediaId: string) => void;
  relinkMediaItem: (
    itemId: string,
    candidate: MediaRelinkCandidate,
  ) => Promise<RelinkReport>;
};

const STATE_LABELS: Record<MediaSyncState, string> = {
  receiving: "Receiving",
  queued: "Queued",
  unavailable: "Unavailable",
  offline: "Offline",
  ready: "Ready",
};

const ROLE_LABELS: Record<MediaSyncRole, string> = {
  arrangement: "Arrangement",
  source: "Source track",
  "main-audio": "Main audio",
  unused: "Not used by any clips",
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function fileBasename(path: string) {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function kindIcon(entry: MediaSyncEntry) {
  return entry.role === "main-audio" || entry.item?.kind === "audio"
    ? "♪"
    : "▶";
}

/**
 * Lists every session media item with its live sync state and transfer
 * progress, while in a shared session or while a sample's media downloads.
 * It doesn't block the editor: items no peer could serve, or whose download
 * failed, can be retried or located on disk.
 */
export function MediaSyncDialog({
  open,
  onOpenChange,
  ...props
}: MediaSyncDialogProps) {
  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="offline-media-dialog media-sync-dialog"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <MediaSyncDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function MediaSyncDialogBody({
  entries,
  summary,
  peer,
  relinkingIds,
  retryMedia,
  relinkMediaItem,
}: Omit<MediaSyncDialogProps, "open" | "onOpenChange">) {
  const [showReady, setShowReady] = useState(false);
  const [pendingForcedLink, setPendingForcedLink] =
    useState<PendingForcedLink | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const pending = entries.filter((entry) => entry.state !== "ready");
  const ready = entries.filter((entry) => entry.state === "ready");
  const remaining = summary.syncing + summary.offline;
  const failedDownloads = entries.filter(
    (entry) => entry.state === "unavailable" && entry.source === "url",
  ).length;

  async function linkItem(itemId: string, candidate: MediaRelinkCandidate) {
    setPendingForcedLink(null);
    setIsBusy(true);
    try {
      await relinkMediaItem(itemId, candidate);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLocate(entry: MediaSyncEntry) {
    const item = entry.item;
    if (!item) {
      return;
    }
    const candidate = (await pickRelinkCandidates("file"))?.[0];
    if (!candidate) {
      return;
    }
    if (forcedRelinkWarning(item, candidate)) {
      setPendingForcedLink({ itemId: item.id, candidate });
      return;
    }
    await linkItem(item.id, candidate);
  }

  function renderRow(entry: MediaSyncEntry) {
    const percent = Math.floor(mediaSyncFraction(entry) * 100);
    const isRelinking = relinkingIds.has(entry.id);
    const canRecover =
      Boolean(entry.item) &&
      (entry.state === "unavailable" || entry.state === "offline");
    const confirm =
      pendingForcedLink?.itemId === entry.id ? pendingForcedLink : null;
    return (
      <li
        className={`media-sync-dialog__row media-sync-dialog__row--${entry.state}`}
        key={entry.id}
      >
        <span aria-hidden="true" className="media-sync-dialog__icon">
          {kindIcon(entry)}
        </span>
        <div className="offline-media__info">
          <strong className="offline-media__name" title={entry.displayName}>
            {entry.displayName}
          </strong>
          <small className="offline-media__usage">
            {ROLE_LABELS[entry.role]}
            {entry.source === "url" ? " · from Sample" : null}
            {peer &&
            entry.source === "peer" &&
            (entry.state === "receiving" || entry.state === "queued") ? (
              <>
                {" · from "}
                <span
                  className="media-sync-dialog__peer"
                  style={{ color: peer.color }}
                >
                  {peer.name}
                </span>
              </>
            ) : null}
          </small>
          {entry.state === "receiving" || entry.state === "queued" ? (
            <div className="media-sync-dialog__progress">
              <div
                aria-label={`${entry.displayName} progress`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={percent}
                className="media-sync-dialog__bar"
                role="progressbar"
              >
                <span
                  className="media-sync-dialog__bar-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <small className="media-sync-dialog__bytes">
                {entry.state === "queued"
                  ? "Waiting…"
                  : entry.total > 0
                    ? `${percent}% · ${formatMegabytes(entry.received)} / ${formatMegabytes(entry.total)} MB`
                    : "Starting…"}
              </small>
            </div>
          ) : null}
          {confirm && entry.item ? (
            <div className="offline-media__confirm">
              <span>
                Link{" "}
                <code>
                  {fileBasename(relinkCandidateFile(confirm.candidate))}
                </code>{" "}
                in place of <code>{mediaDisplayName(entry.item)}</code>?
              </span>
              <button
                className="ghost-button ghost-button--accent"
                disabled={isBusy}
                onClick={() => void linkItem(confirm.itemId, confirm.candidate)}
                type="button"
              >
                Link
              </button>
              <button
                className="ghost-button"
                onClick={() => setPendingForcedLink(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
        <span
          className={`media-sync-dialog__chip media-sync-dialog__chip--${entry.state}`}
          title={entry.item?.lastError}
        >
          {entry.state === "receiving" || isRelinking ? (
            <span aria-hidden="true" className="offline-media__spinner" />
          ) : null}
          {isRelinking ? "Linking…" : STATE_LABELS[entry.state]}
        </span>
        {canRecover ? (
          <div className="media-sync-dialog__actions">
            {entry.state === "unavailable" ? (
              <button
                className="ghost-button offline-media__locate"
                disabled={isBusy || isRelinking}
                onClick={() => retryMedia(entry.id)}
                type="button"
              >
                Retry
              </button>
            ) : null}
            <button
              className="ghost-button offline-media__locate"
              disabled={isBusy || isRelinking}
              onClick={() => void handleLocate(entry)}
              type="button"
            >
              Locate on disk…
            </button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Media Sync</DialogTitle>
        <DialogDescription>
          {summary.syncing
            ? `${summary.percent}% ${summary.loading ? "loaded" : "synced"} · ${pluralize(remaining, "file")} remaining`
            : summary.offline
              ? failedDownloads === summary.offline
                ? `${pluralize(failedDownloads, "file")} could not be downloaded.`
                : `${pluralize(summary.offline, "file")} no connected peer could send.`
              : "All session media is ready."}
        </DialogDescription>
      </DialogHeader>

      {summary.syncing ? (
        <div
          aria-label="Overall media sync progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={summary.percent}
          className="media-sync-dialog__bar media-sync-dialog__bar--overall"
          role="progressbar"
        >
          <span
            className="media-sync-dialog__bar-fill"
            style={{ width: `${summary.percent}%` }}
          />
        </div>
      ) : null}

      <ul className="offline-media__list">
        {pending.map(renderRow)}
        {ready.length ? (
          <li className="media-sync-dialog__ready">
            <button
              aria-expanded={showReady}
              className="offline-media__toggle"
              onClick={() => setShowReady((current) => !current)}
              type="button"
            >
              {`${ready.length} ready`}
            </button>
          </li>
        ) : null}
        {showReady ? ready.map(renderRow) : null}
      </ul>

      <DialogFooter className="offline-media__footer">
        <DialogClose asChild>
          <button className="ghost-button ghost-button--accent" type="button">
            Close
          </button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}
