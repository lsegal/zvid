import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
} from "react";
import type { ClipClipboard } from "../app/clip-ops.ts";
import { patchProjectState } from "../app/session-project.ts";
import {
  type SourceSelection,
  selectSourceSpan,
  selectSourceTrack,
} from "../app/source-selection.ts";
import { getClipEndQ } from "../app/timeline-math.ts";
import type { ProjectState, SourceSpan } from "../app/types.ts";
import { canSplitAt } from "../clip-menu.ts";
import {
  canPasteIntoSourceTrack,
  deleteSourceSpan,
  duplicateSourceSpan,
  pasteIntoSourceTrack,
  type SourceClipPatch,
  splitSourceSpan,
} from "../source-clip-edits.ts";
import { SOURCE_TRACKS_LOCKED_TITLE } from "../source-tracks-section.ts";

export type SourceClipActionsInputs = {
  bpm: number;
  clipClipboardRef: RefObject<ClipClipboard | null>;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  copySourceSpan: (span: SourceSpan) => void;
  jumpPlayheadTo: (startQ: number) => void;
  playheadQRef: RefObject<number>;
  selectSource: (selection: SourceSelection | undefined) => void;
  setStatus: Dispatch<SetStateAction<string>>;
  sourceTracksLocked: boolean;
};

const newSourceSpanId = () => `source-span-${crypto.randomUUID()}`;

// The source clip menu's and keyboard shortcuts' actions, like the layer
// clip ones within the clip's source track. Each edit is one undo step.
// While the source tracks are locked, edits that change their timing or
// content do nothing; Jump to start and Copy still work.
export function useSourceClipActions({
  bpm,
  clipClipboardRef,
  commitProjectChange,
  copySourceSpan,
  jumpPlayheadTo,
  playheadQRef,
  selectSource,
  setStatus,
  sourceTracksLocked,
}: SourceClipActionsInputs) {
  // Commits `edit` unless the source tracks are locked; false when locked.
  // The store applies it later, against the project as it is then.
  function commitEdit(
    label: string,
    edit: (current: ProjectState) => SourceClipPatch | undefined,
  ) {
    if (sourceTracksLocked) {
      setStatus(`${SOURCE_TRACKS_LOCKED_TITLE}.`);
      return false;
    }

    commitProjectChange(label, (current) => {
      const patch = edit(current);
      return patch ? patchProjectState(current, patch) : current;
    });
    return true;
  }

  function jumpToStart(span: SourceSpan) {
    selectSource(selectSourceSpan(span));
    jumpPlayheadTo(span.startQ);
  }

  function removeSourceSpan(span: SourceSpan, label: string) {
    const removed = commitEdit(label, (current) =>
      deleteSourceSpan(current, span.id),
    );
    if (removed) {
      selectSource(selectSourceTrack(span.sourceTrackId));
    }
    return removed;
  }

  function cut(span: SourceSpan) {
    if (sourceTracksLocked) {
      setStatus(`${SOURCE_TRACKS_LOCKED_TITLE}.`);
      return;
    }

    copySourceSpan(span);
    removeSourceSpan(span, "Cut source clip");
    setStatus(`Cut ${span.label}.`);
  }

  function remove(span: SourceSpan) {
    if (removeSourceSpan(span, "Delete source clip")) {
      setStatus(`Deleted ${span.label}.`);
    }
  }

  // Pastes into the clip's source track at the playhead.
  function paste(span: SourceSpan) {
    const clipboard = clipClipboardRef.current;
    if (!canPasteIntoSourceTrack(clipboard)) {
      setStatus("Only media clips can be pasted into a source track.");
      return;
    }

    const pastedIds = clipboard.sourceSpan
      ? [newSourceSpanId()]
      : clipboard.fragments.map(newSourceSpanId);
    const pasteQ = playheadQRef.current;
    const pasted = commitEdit("Paste source clip", (current) => {
      const ids = [...pastedIds];
      return pasteIntoSourceTrack(
        current,
        clipboard,
        span.sourceTrackId,
        pasteQ,
        () => ids.shift() ?? newSourceSpanId(),
      );
    });
    if (!pasted) {
      return;
    }

    selectSource(
      selectSourceSpan({ id: pastedIds[0], sourceTrackId: span.sourceTrackId }),
    );
    setStatus(
      pastedIds.length === 1
        ? "Pasted into the source track."
        : `Pasted ${pastedIds.length} source clips.`,
    );
  }

  function duplicate(span: SourceSpan) {
    const id = newSourceSpanId();
    if (
      commitEdit("Duplicate source clip", (current) =>
        duplicateSourceSpan(current, span.id, id),
      )
    ) {
      selectSource(selectSourceSpan({ id, sourceTrackId: span.sourceTrackId }));
      setStatus(`Duplicated ${span.label}.`);
    }
  }

  function split(span: SourceSpan) {
    const splitQ = playheadQRef.current;
    if (!canSplitAt(span.startQ, getClipEndQ(span, bpm), splitQ)) {
      setStatus(`Move the playhead inside ${span.label} to split it.`);
      return;
    }

    const id = newSourceSpanId();
    if (
      commitEdit("Split source clip", (current) =>
        splitSourceSpan(current, span.id, splitQ, id),
      )
    ) {
      selectSource(selectSourceSpan({ id, sourceTrackId: span.sourceTrackId }));
      setStatus(`Split ${span.label} at the playhead.`);
    }
  }

  const sourceClipActions = {
    jumpToStart,
    cut,
    copy: copySourceSpan,
    paste,
    duplicate,
    split,
    remove,
  };
  // The keyboard shortcuts read the latest actions without re-subscribing.
  const sourceClipActionsRef = useRef(sourceClipActions);
  sourceClipActionsRef.current = sourceClipActions;

  return { sourceClipActions, sourceClipActionsRef };
}
