import { getHarness, type MediaSelection } from "./harness";
import { createMediaId, type MediaItem } from "./media";
import {
  forcedRelinkWarning,
  matchOfflineMedia,
  type OfflineMediaEntry,
  type RelinkCandidate,
  type RelinkOutcome,
  type RelinkReport,
  relinkCandidateFile,
} from "./relink";
import type { ServerMediaRef } from "./session";

export type RelinkSource =
  | { kind: "file"; file: File }
  | { kind: "ref"; ref: ServerMediaRef };

export type MediaRelinkCandidate = RelinkCandidate<RelinkSource>;

export function fileRelinkCandidate(
  file: File,
  path = file.webkitRelativePath || file.name,
): MediaRelinkCandidate {
  return {
    name: file.name,
    path,
    id: createMediaId(file),
    source: { kind: "file", file },
  };
}

export function refRelinkCandidate(ref: ServerMediaRef): MediaRelinkCandidate {
  return { name: ref.name, path: ref.path, source: { kind: "ref", ref } };
}

export function relinkCandidatesFromSelection(selection: MediaSelection) {
  return selection.kind === "files"
    ? selection.files.map((file) => fileRelinkCandidate(file))
    : selection.refs.map(refRelinkCandidate);
}

/** Asks the user for replacement media; null when the picker is cancelled. */
export async function pickRelinkCandidates(mode: "files" | "folder") {
  const harness = getHarness();
  if (mode === "folder" && harness.pickMediaFolder) {
    const entries = await harness.pickMediaFolder();
    return entries
      ? entries.map(({ file, path }) =>
          fileRelinkCandidate(file, file.webkitRelativePath || path),
        )
      : null;
  }

  const selection = await harness.pickMedia();
  return selection ? relinkCandidatesFromSelection(selection) : null;
}

type MediaRelinkerOptions = {
  offlineMedia: OfflineMediaEntry[];
  mediaItemsById: Map<string, MediaItem>;
  adoptMediaBlob: (
    mediaId: string,
    blob: Blob,
    options: { verify: boolean },
  ) => Promise<{ warning?: string }>;
  log: (event: string, payload?: unknown) => void;
};

export function createMediaRelinker({
  offlineMedia,
  mediaItemsById,
  adoptMediaBlob,
  log,
}: MediaRelinkerOptions) {
  async function linkCandidate(
    item: MediaItem,
    candidate: MediaRelinkCandidate,
  ): Promise<RelinkOutcome> {
    const file = relinkCandidateFile(candidate);
    try {
      const blob =
        candidate.source.kind === "file"
          ? candidate.source.file
          : await getHarness().readMediaBlob({
              id: item.id,
              name: candidate.source.ref.name,
              previewUrl: candidate.source.ref.url,
              sourcePath: candidate.source.ref.path,
            });
      const { warning } = await adoptMediaBlob(item.id, blob, {
        verify: true,
      });
      return warning
        ? { status: "linked", item, file, warning }
        : { status: "linked", item, file };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log("media:locate:error", { mediaId: item.id, message: reason });
      return { status: "failed", item, file, reason };
    }
  }

  /**
   * Matches picked files against offline media (optionally only `targets`)
   * and links every match, reporting one outcome per picked file.
   */
  async function relinkMedia(
    candidates: MediaRelinkCandidate[],
    { targets }: { targets?: string[] } = {},
  ): Promise<RelinkReport> {
    const targetIds = targets ? new Set(targets) : undefined;
    const offlineItems = offlineMedia
      .map((entry) => entry.item)
      .filter((item) => !targetIds || targetIds.has(item.id));
    const { matches, unmatched, ambiguous } = matchOfflineMedia(
      offlineItems,
      candidates,
    );
    if (unmatched.length) {
      log("media:locate:unmatched", {
        files: unmatched.map(relinkCandidateFile),
      });
    }
    if (ambiguous.length) {
      log(
        "media:locate:ambiguous",
        ambiguous.map(({ candidate, items }) => ({
          file: relinkCandidateFile(candidate),
          media: items.map((item) => item.sourcePath ?? item.name),
        })),
      );
    }

    const outcomes = new Map<MediaRelinkCandidate, RelinkOutcome>();
    for (const candidate of unmatched) {
      outcomes.set(candidate, {
        status: "unmatched",
        file: relinkCandidateFile(candidate),
      });
    }
    for (const { candidate, items } of ambiguous) {
      outcomes.set(candidate, {
        status: "ambiguous",
        file: relinkCandidateFile(candidate),
        items,
      });
    }
    for (const { item, candidate } of matches) {
      outcomes.set(candidate, await linkCandidate(item, candidate));
    }

    const ordered = candidates.flatMap((candidate) => {
      const outcome = outcomes.get(candidate);
      return outcome ? [outcome] : [];
    });
    const linked = ordered.filter(
      (outcome) => outcome.status === "linked",
    ).length;
    return {
      outcomes: ordered,
      remainingOffline: offlineItems.length - linked,
    };
  }

  /** Links one picked file to one media item without matching by name. */
  async function relinkMediaItem(
    itemId: string,
    candidate: MediaRelinkCandidate,
  ): Promise<RelinkReport> {
    const item = mediaItemsById.get(itemId);
    if (!item) {
      return {
        outcomes: [
          { status: "unmatched", file: relinkCandidateFile(candidate) },
        ],
        remainingOffline: offlineMedia.length,
      };
    }

    let outcome = await linkCandidate(item, candidate);
    if (outcome.status === "linked") {
      const warning = [forcedRelinkWarning(item, candidate), outcome.warning]
        .filter(Boolean)
        .join("; ");
      if (warning) {
        outcome = { ...outcome, warning };
      }
    }
    const wasOffline = offlineMedia.some((entry) => entry.item.id === itemId);
    return {
      outcomes: [outcome],
      remainingOffline:
        offlineMedia.length -
        (wasOffline && outcome.status === "linked" ? 1 : 0),
    };
  }

  return { relinkMedia, relinkMediaItem };
}
