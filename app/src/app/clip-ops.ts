import { clipEffectTrackId, type SessionEffect } from "../fx-stack.ts";
import type { ClipboardContent } from "../range-edit.ts";
import { syncClipsToSourceSpans } from "../source-track-content.ts";
import { getClipEndQ, quartersToSeconds } from "./timeline-math.ts";
import type {
  ArrangementClip,
  SourceSpan,
  SourceTrack,
  TimelineSelection,
} from "./types.ts";

// A window on `sourceTrack` over the selection's time, showing whatever the
// track holds there. `sourceSpan`, a source clip of the track, is the first
// it shows (see source-track-content.ts).
export function createWindowClip(
  selection: TimelineSelection,
  sourceTrack: SourceTrack,
  sourceSpan: SourceSpan,
  sourceSpans: SourceSpan[],
  bpm: number,
  id = `window-${crypto.randomUUID()}`,
): ArrangementClip {
  const sourceOffsetSeconds =
    sourceSpan.trimStartSeconds - quartersToSeconds(sourceSpan.startQ, bpm);
  const clip: ArrangementClip = {
    id,
    sourceSpanId: sourceSpan.id,
    sourceTrackId: sourceTrack.id,
    laneId: selection.laneId,
    label: sourceTrack.name,
    mediaPath: sourceSpan.mediaPath,
    mediaId: sourceSpan.mediaId,
    startQ: selection.startQ,
    durationSeconds: quartersToSeconds(selection.durationQ, bpm),
    trimStartSeconds:
      quartersToSeconds(selection.startQ, bpm) + sourceOffsetSeconds,
    sourceOffsetSeconds,
    sourceSpanOffsetSeconds: sourceOffsetSeconds,
    sourceWindowStartSeconds: sourceSpan.trimStartSeconds,
    sourceWindowEndSeconds:
      sourceSpan.trimStartSeconds + sourceSpan.durationSeconds,
    warp: sourceSpan.warp,
    tint: sourceSpan.tint,
    accent: sourceSpan.accent,
  };
  // Its media fields describe the first source clip it shows.
  return syncClipsToSourceSpans([clip], sourceSpans, sourceSpans, bpm)[0];
}

export function cloneClipAtStartQ(
  clip: ArrangementClip,
  bpm: number,
  startQ: number,
  id = `window-${crypto.randomUUID()}`,
) {
  return {
    ...clip,
    id,
    startQ,
    trimStartSeconds: clip.trimStartSeconds,
    sourceOffsetSeconds: clip.trimStartSeconds - quartersToSeconds(startQ, bpm),
  };
}

// Clipboard content with the effect stacks of the clips it was copied from,
// taken when copying, so a cut clip still pastes with its effects.
export type ClipClipboard = ClipboardContent<ArrangementClip> & {
  effects?: SessionEffect[];
  // The source clip it was copied from, so pasting into a source track
  // recreates it with its stack (in `effects`). Set only on content copied
  // from a source clip; layer content leaves it out.
  sourceSpan?: SourceSpan;
  // The source clips of a copied multi-selection, placed like `fragments`
  // (see multi-selection.ts). Set only on content copied from one.
  sourceFragments?: Array<{ span: SourceSpan; offsetQ: number }>;
};

// Where clipboard content was copied from. Source clips paste only into
// source tracks, and layer clips only onto layers.
export type ClipClipboardKind = "source" | "layer";

export function clipClipboardKind(clipboard: ClipClipboard): ClipClipboardKind {
  return clipboard.sourceSpan ? "source" : "layer";
}

/** Whether `clipboard` holds layer clips to paste onto a layer. */
export function canPasteOntoLayer(
  clipboard: ClipClipboard | null,
): clipboard is ClipClipboard {
  return (
    clipboard !== null &&
    clipClipboardKind(clipboard) === "layer" &&
    clipboard.fragments.length > 0
  );
}

export function withClipStacks(
  content: ClipboardContent<ArrangementClip>,
  effects: readonly SessionEffect[],
): ClipClipboard {
  const trackIds = new Set(
    content.fragments.map((fragment) => clipEffectTrackId(fragment.clip.id)),
  );
  return {
    ...content,
    effects: effects.filter((effect) => trackIds.has(effect.trackId)),
  };
}

export function duplicateClip(
  clip: ArrangementClip,
  bpm: number,
  id = `window-${crypto.randomUUID()}`,
) {
  return cloneClipAtStartQ(clip, bpm, getClipEndQ(clip, bpm), id);
}
