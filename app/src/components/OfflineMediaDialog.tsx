import { useEffect, useState } from "react";
import type { MediaItem } from "../media";
import {
  type MediaRelinkCandidate,
  pickRelinkCandidates,
} from "../media-relink";
import {
  forcedRelinkWarning,
  mediaDisplayName,
  type OfflineMediaEntry,
  type RelinkOutcome,
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

type ItemOutcome = Extract<RelinkOutcome, { item: MediaItem }>;

type RowTone = "offline" | "loading" | "linking" | "linked" | "warning" | "failed";

type PendingForcedLink = {
  itemId: string;
  candidate: MediaRelinkCandidate;
};

type OfflineMediaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offlineMedia: OfflineMediaEntry[];
  mediaItemsById: Map<string, MediaItem>;
  relinkingIds: ReadonlySet<string>;
  canLocateFolder: boolean;
  relinkMedia: (candidates: MediaRelinkCandidate[]) => Promise<RelinkReport>;
  relinkMediaItem: (
    itemId: string,
    candidate: MediaRelinkCandidate,
  ) => Promise<RelinkReport>;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function fileBasename(path: string) {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function rowState(
  entry: OfflineMediaEntry,
  live: MediaItem | undefined,
  outcome: ItemOutcome | undefined,
  isRelinking: boolean,
): { tone: RowTone; label: string; detail?: string } {
  if (isRelinking) {
    return { tone: "linking", label: "Linking…" };
  }

  const availability = live?.availability ?? entry.item.availability;
  if (availability === "ready") {
    return outcome?.status === "linked" && outcome.warning
      ? { tone: "warning", label: "Linked with warning", detail: outcome.warning }
      : { tone: "linked", label: "Linked ✓" };
  }
  if (availability === "hydrating") {
    return { tone: "loading", label: "Loading…" };
  }

  const reason =
    outcome?.status === "failed" ? outcome.reason : live?.lastError;
  return reason
    ? { tone: "failed", label: `Failed: ${reason}`, detail: reason }
    : { tone: "offline", label: "Offline" };
}

/**
 * Lists every offline media file and lets the user locate each one, or
 * several at once, keeping relinked rows in place so each result stays
 * visible until the dialog is dismissed.
 */
export function OfflineMediaDialog({
  open,
  onOpenChange,
  ...props
}: OfflineMediaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="offline-media-dialog">
        {/* Mounted only while open, so each opening starts from a fresh list. */}
        <OfflineMediaDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function OfflineMediaDialogBody({
  offlineMedia,
  mediaItemsById,
  relinkingIds,
  canLocateFolder,
  relinkMedia,
  relinkMediaItem,
}: Omit<OfflineMediaDialogProps, "open" | "onOpenChange">) {
  const [rows, setRows] = useState(offlineMedia);
  const [outcomes, setOutcomes] = useState<Record<string, ItemOutcome>>({});
  const [report, setReport] = useState<RelinkReport | null>(null);
  const [showReportDetails, setShowReportDetails] = useState(false);
  const [pendingForcedLink, setPendingForcedLink] =
    useState<PendingForcedLink | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Relinked media leaves `offlineMedia`, but its row stays so the user can
  // see what changed; media that goes offline while open is appended.
  useEffect(() => {
    setRows((current) => {
      const latest = new Map(
        offlineMedia.map((entry) => [entry.item.id, entry]),
      );
      const known = new Set(current.map((entry) => entry.item.id));
      const added = offlineMedia.filter((entry) => !known.has(entry.item.id));
      const refreshed = current.map(
        (entry) => latest.get(entry.item.id) ?? entry,
      );
      const changed =
        added.length > 0 ||
        refreshed.some((entry, index) => entry !== current[index]);
      return changed ? [...refreshed, ...added] : current;
    });
  }, [offlineMedia]);

  function recordOutcomes(next: RelinkReport) {
    const itemOutcomes = next.outcomes.filter(
      (outcome): outcome is ItemOutcome => "item" in outcome,
    );
    if (!itemOutcomes.length) {
      return;
    }
    setOutcomes((current) => {
      const updated = { ...current };
      for (const outcome of itemOutcomes) {
        updated[outcome.item.id] = outcome;
      }
      return updated;
    });
  }

  async function runAction(action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLocateBatch(mode: "files" | "folder") {
    const candidates = await pickRelinkCandidates(mode);
    if (!candidates) {
      return;
    }

    await runAction(async () => {
      const next = await relinkMedia(candidates);
      recordOutcomes(next);
      setReport(next);
      setShowReportDetails(false);
    });
  }

  async function handleLocateItem(entry: OfflineMediaEntry) {
    const candidates = await pickRelinkCandidates("file");
    const candidate = candidates?.[0];
    if (!candidate) {
      return;
    }

    if (forcedRelinkWarning(entry.item, candidate)) {
      setPendingForcedLink({ itemId: entry.item.id, candidate });
      return;
    }
    await linkItem(entry.item.id, candidate);
  }

  async function linkItem(itemId: string, candidate: MediaRelinkCandidate) {
    setPendingForcedLink(null);
    await runAction(async () => {
      recordOutcomes(await relinkMediaItem(itemId, candidate));
    });
  }

  const missingCount = offlineMedia.length;
  const unresolved = report
    ? report.outcomes.filter(
        (outcome) =>
          outcome.status === "unmatched" || outcome.status === "ambiguous",
      )
    : [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Offline Media</DialogTitle>
        <DialogDescription>
          {missingCount
            ? `${pluralize(missingCount, "file")} can't be found. Locate them to restore playback.`
            : "Every media file in this session is linked."}
        </DialogDescription>
      </DialogHeader>

      {missingCount === 0 ? (
        <p className="offline-media__banner offline-media__banner--success">
          All media is linked ✓
        </p>
      ) : null}

      {report ? (
        <OfflineMediaReport
          expanded={showReportDetails}
          onToggle={() => setShowReportDetails((current) => !current)}
          report={report}
          unresolved={unresolved}
        />
      ) : null}

      <ul className="offline-media__list">
        {rows.map((entry) => {
          const itemId = entry.item.id;
          const live = mediaItemsById.get(itemId);
          const state = rowState(
            entry,
            live,
            outcomes[itemId],
            relinkingIds.has(itemId),
          );
          const pending =
            pendingForcedLink?.itemId === itemId ? pendingForcedLink : null;
          return (
            <li className="offline-media__row" key={itemId}>
              <div className="offline-media__info">
                <strong className="offline-media__name">
                  {entry.displayName}
                </strong>
                {entry.sourcePath ? (
                  <small className="offline-media__path" title={entry.sourcePath}>
                    {entry.sourcePath}
                  </small>
                ) : null}
                <small className="offline-media__usage">
                  {entry.clipCount
                    ? `Used by ${pluralize(entry.clipCount, "clip")}`
                    : "Not used by any clips"}
                </small>
                {pending ? (
                  <div className="offline-media__confirm">
                    <span>
                      Link{" "}
                      <code>{fileBasename(relinkCandidateFile(pending.candidate))}</code>{" "}
                      in place of <code>{mediaDisplayName(entry.item)}</code>?
                    </span>
                    <button
                      className="ghost-button ghost-button--accent"
                      disabled={isBusy}
                      onClick={() =>
                        void linkItem(pending.itemId, pending.candidate)
                      }
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
                className={`offline-media__badge offline-media__badge--${state.tone}`}
                title={state.detail}
              >
                {state.tone === "linking" || state.tone === "loading" ? (
                  <span aria-hidden="true" className="offline-media__spinner" />
                ) : null}
                {state.label}
              </span>
              <button
                className="ghost-button offline-media__locate"
                disabled={isBusy || state.tone === "linking"}
                onClick={() => void handleLocateItem(entry)}
                type="button"
              >
                Locate…
              </button>
            </li>
          );
        })}
      </ul>

      <DialogFooter className="offline-media__footer">
        <button
          className="ghost-button"
          disabled={isBusy || !missingCount}
          onClick={() => void handleLocateBatch("files")}
          type="button"
        >
          Locate Files…
        </button>
        {canLocateFolder ? (
          <button
            className="ghost-button"
            disabled={isBusy || !missingCount}
            onClick={() => void handleLocateBatch("folder")}
            type="button"
          >
            Locate Folder…
          </button>
        ) : null}
        <DialogClose asChild>
          <button className="ghost-button ghost-button--accent" type="button">
            Done
          </button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}

function OfflineMediaReport({
  report,
  unresolved,
  expanded,
  onToggle,
}: {
  report: RelinkReport;
  unresolved: RelinkOutcome[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const count = (status: RelinkOutcome["status"]) =>
    report.outcomes.filter((outcome) => outcome.status === status).length;
  const linked = count("linked");
  const failed = count("failed");
  const unmatched = count("unmatched");
  const ambiguous = count("ambiguous");

  const parts = report.outcomes.length
    ? [
        `Linked ${linked}`,
        failed ? `${failed} failed` : "",
        unmatched
          ? `${pluralize(unmatched, "file")} didn't match any offline media`
          : "",
        ambiguous
          ? `${pluralize(ambiguous, "file")} matched more than one offline file`
          : "",
      ].filter(Boolean)
    : ["No media files were found in the selection"];

  return (
    <div
      className={`offline-media__banner ${failed || unresolved.length ? "offline-media__banner--warning" : "offline-media__banner--success"}`}
      role="status"
    >
      <p>
        {parts.join(" · ")}
        {unresolved.length ? (
          <>
            {" "}
            <button
              aria-expanded={expanded}
              className="offline-media__toggle"
              onClick={onToggle}
              type="button"
            >
              {expanded ? "(hide)" : "(show)"}
            </button>
          </>
        ) : null}
      </p>
      {expanded ? (
        <ul className="offline-media__unresolved">
          {unresolved.map((outcome, index) => (
            <li key={`${outcome.file}:${index}`}>
              <code title={outcome.file}>{fileBasename(outcome.file)}</code>
              {outcome.status === "ambiguous"
                ? ` could be ${outcome.items.map(mediaDisplayName).join(" or ")}. Use Locate… on the right row.`
                : " didn't match any offline media."}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
