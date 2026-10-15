import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ClipClipboard } from "../app/clip-ops.ts";
import {
  copyMultiSelection,
  type MultiPasteTarget,
  type MultiSelectionContent,
  pasteMultiClipboard,
  removeMultiSelection,
  type SelectionItem,
} from "../app/multi-selection.ts";
import { plural } from "../status-bar/plural.ts";
import type {
  ArrangementClip,
  ProjectState,
  SourceSpan,
  TimelineSelection,
} from "../app/types.ts";
import type { SessionEffect } from "../fx-stack";
import { SOURCE_TRACKS_LOCKED_TITLE } from "../source-tracks-section.ts";

export type MultiSelectionActionsInputs = {
  bpm: number;
  clipClipboardRef: RefObject<ClipClipboard | null>;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  effects: SessionEffect[];
  playheadQRef: RefObject<number>;
  selectionItems: readonly SelectionItem[];
  applySelection: (items: readonly SelectionItem[]) => void;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  sourceSpans: SourceSpan[];
  sourceTracksLocked: boolean;
  timelineClips: ArrangementClip[];
};

// Copy, Cut, Delete, Duplicate and Paste for several selected clips and
// source clips at once (see multi-selection.ts), each one undo step. The
// single-clip commands hand over to these when the clip they act on is one
// of several selected. While the source tracks are locked, edits that would
// change a source clip do nothing.
export function useMultiSelectionActions({
  bpm,
  clipClipboardRef,
  commitProjectChange,
  effects,
  playheadQRef,
  selectionItems,
  applySelection,
  setPendingSelection,
  setStatus,
  sourceSpans,
  sourceTracksLocked,
  timelineClips,
}: MultiSelectionActionsInputs) {
  const covers = (item: Pick<SelectionItem, "kind" | "id">) =>
    selectionItems.length > 1 &&
    selectionItems.some(
      (candidate) => candidate.kind === item.kind && candidate.id === item.id,
    );

  function content(): MultiSelectionContent {
    const ids = new Set(selectionItems.map((item) => `${item.kind}:${item.id}`));
    return {
      clips: timelineClips.filter((clip) => ids.has(`clip:${clip.id}`)),
      spans: sourceSpans.filter((span) => ids.has(`span:${span.id}`)),
    };
  }

  const count = ({ clips, spans }: MultiSelectionContent) =>
    plural(clips.length + spans.length, "clip");

  function refuseLocked(hasSourceClips: boolean) {
    if (hasSourceClips && sourceTracksLocked) {
      setStatus(`${SOURCE_TRACKS_LOCKED_TITLE}.`);
      return true;
    }
    return false;
  }

  function copy() {
    const selected = content();
    clipClipboardRef.current = copyMultiSelection(selected, bpm, effects);
    setStatus(`Copied ${count(selected)}.`);
  }

  function removeSelected(label: string) {
    const selected = content();
    const clipIds = new Set(selected.clips.map((clip) => clip.id));
    const spanIds = new Set(selected.spans.map((span) => span.id));
    commitProjectChange(label, (current) =>
      removeMultiSelection(current, clipIds, spanIds),
    );
    applySelection([]);
    setPendingSelection(null);
    return selected;
  }

  function cut() {
    const selected = content();
    if (refuseLocked(selected.spans.length > 0)) {
      return;
    }
    clipClipboardRef.current = copyMultiSelection(selected, bpm, effects);
    removeSelected("Cut clips");
    setStatus(`Cut ${count(selected)}.`);
  }

  function remove() {
    const selected = content();
    if (refuseLocked(selected.spans.length > 0)) {
      return;
    }
    removeSelected("Delete clips");
    setStatus(`Deleted ${count(selected)}.`);
  }

  // Places `clipboard` from `pasteQ` and selects what it placed.
  function place(
    clipboard: ClipClipboard,
    target: MultiPasteTarget,
    pasteQ: number,
    label: string,
  ) {
    const sourceFragments = clipboard.sourceFragments ?? [];
    if (refuseLocked(sourceFragments.length > 0)) {
      return false;
    }
    const spanIds = sourceFragments.map(
      () => `source-span-${crypto.randomUUID()}`,
    );
    const clipIds = clipboard.fragments.map(
      () => `window-${crypto.randomUUID()}`,
    );
    commitProjectChange(label, (current) => {
      const spanQueue = [...spanIds];
      const clipQueue = [...clipIds];
      return pasteMultiClipboard(current, clipboard, target, pasteQ, (kind) =>
        (kind === "span" ? spanQueue.shift() : clipQueue.shift()) ??
        `${kind === "span" ? "source-span" : "window"}-${crypto.randomUUID()}`,
      ).project;
    });
    // A pasted source clip's track is looked up again once it exists.
    applySelection([
      ...sourceFragments.map(
        ({ span }, index): SelectionItem => ({
          kind: "span",
          id: spanIds[index],
          sourceTrackId: target.sourceTrackId ?? span.sourceTrackId,
        }),
      ),
      ...clipIds.map((id): SelectionItem => ({ kind: "clip", id })),
    ]);
    setPendingSelection(null);
    return true;
  }

  // Pastes a copied multi-selection at the playhead: onto `target.laneId`
  // and into `target.sourceTrackId` when given, else onto the layers and
  // into the source tracks it was copied from.
  function paste(target: MultiPasteTarget) {
    const clipboard = clipClipboardRef.current;
    if (!clipboard) {
      return;
    }
    const pastedCount =
      clipboard.fragments.length + (clipboard.sourceFragments?.length ?? 0);
    if (place(clipboard, target, playheadQRef.current, "Paste clips")) {
      setStatus(`Pasted ${plural(pastedCount, "clip")}.`);
    }
  }

  // Places a copy of the selection right after it, on the same layers and
  // source tracks.
  function duplicate() {
    const selected = content();
    const clipboard = copyMultiSelection(selected, bpm, effects);
    const startQ = Math.min(
      ...[...selected.clips, ...selected.spans].map((item) => item.startQ),
    );
    if (place(clipboard, {}, startQ + clipboard.durationQ, "Duplicate clips")) {
      setStatus(`Duplicated ${count(selected)}.`);
    }
  }

  return { covers, copy, cut, remove, duplicate, paste };
}

export type MultiSelectionActions = ReturnType<
  typeof useMultiSelectionActions
>;
