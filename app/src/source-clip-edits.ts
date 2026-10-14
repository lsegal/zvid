// Pasting, duplicating, splitting and deleting source clips (source spans)
// from their right-click menu and the keyboard shortcuts, and creating empty
// MIDI clips from the source lane menu. Each returns the project patch for
// one undo step. Pieces placed onto other spans in the same source track
// overwrite them as a moved span does; a new MIDI clip fits around them.
// Arrangement clips keep their windows on their source tracks and show
// whatever those now hold (see source-track-content.ts).
import { type ClipClipboard, clipClipboardKind } from "./app/clip-ops.ts";
import { getClipEndQ, quartersToSeconds } from "./app/timeline-math.ts";
import type { ProjectState, SourceSpan } from "./app/types.ts";
import { getSwatch } from "./app/util.ts";
import { canSplitAt } from "./clip-menu.ts";
import { addDefaultGain } from "./default-gain.ts";
import { copyEffectStacks, sourceClipEffectTrackId } from "./fx-stack.ts";
import { newMidiTimeline } from "./midi-clip-timeline.ts";
import { addDefaultSynth } from "./midi-effects.ts";
import {
  resolveSourceSpanOverlaps,
  retimeSourceSpan,
} from "./source-span-edit.ts";
import { syncClipsToSourceSpans } from "./source-track-content.ts";

export type SourceClipProject = Pick<
  ProjectState,
  "bpm" | "clips" | "effects" | "sourceSpans" | "sourceTracks"
>;

export type SourceClipPatch = Partial<
  Pick<ProjectState, "clips" | "effects" | "sourceSpans" | "sourceTracks">
>;

/**
 * Whether `clipboard` can be pasted into a source track: only content copied
 * from a source clip can. Layer clips paste only onto layers.
 */
export function canPasteIntoSourceTrack(
  clipboard: ClipClipboard | null,
): clipboard is ClipClipboard & { sourceSpan: SourceSpan } {
  return clipboard !== null && clipClipboardKind(clipboard) === "source";
}

// `spans` placed in order, each overwriting what it lands on in its track,
// with the arrangement clips synced and each `[from, to]` stack copied
// from `stackSource`.
function placeSourceSpans(
  current: SourceClipProject,
  sourceSpans: SourceSpan[],
  spans: readonly SourceSpan[],
  copies: Iterable<readonly [string, string]>,
  stackSource = current.effects,
): SourceClipPatch {
  let nextSpans = sourceSpans;
  for (const span of spans) {
    nextSpans = resolveSourceSpanOverlaps(
      [...nextSpans, span],
      span,
      current.bpm,
    );
  }
  return {
    sourceSpans: nextSpans,
    clips: syncClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      nextSpans,
      current.bpm,
    ),
    effects: copyEffectStacks(current.effects, copies, stackSource),
  };
}

/**
 * Pastes the source clip `clipboard` was copied from into source track
 * `trackId` at `pasteQ`, with the stack it was copied with. Undefined when
 * there is nothing to paste there: layer clips paste only onto layers.
 */
export function pasteIntoSourceTrack(
  current: SourceClipProject,
  clipboard: ClipClipboard,
  trackId: string,
  pasteQ: number,
  createId: () => string,
): SourceClipPatch | undefined {
  const track = current.sourceTracks.find((item) => item.id === trackId);
  if (!track || !canPasteIntoSourceTrack(clipboard)) {
    return undefined;
  }

  const swatch = getSwatch(track.colorIndex);
  const id = createId();
  const copies: Array<[string, string]> = [
    [
      sourceClipEffectTrackId(clipboard.sourceSpan.id),
      sourceClipEffectTrackId(id),
    ],
  ];
  const spans: SourceSpan[] = [
    {
      ...clipboard.sourceSpan,
      id,
      sourceTrackId: trackId,
      startQ: pasteQ,
      tint: swatch.color,
      accent: swatch.accent,
    },
  ];

  // The track lists the media it plays, as a drop onto it does.
  const newPaths = [...new Set(spans.map((span) => span.mediaPath))].filter(
    (path) => !track.recordingPaths.includes(path),
  );
  return {
    ...(newPaths.length
      ? {
          sourceTracks: current.sourceTracks.map((item) =>
            item.id === trackId
              ? {
                  ...item,
                  recordingPaths: [...item.recordingPaths, ...newPaths],
                }
              : item,
          ),
        }
      : {}),
    ...placeSourceSpans(
      current,
      current.sourceSpans,
      spans,
      copies,
      clipboard.effects ?? current.effects,
    ),
  };
}

/**
 * A copy of source clip `spanId`, with its stack, right after it in its
 * source track, overwriting what it lands on.
 */
export function duplicateSourceSpan(
  current: SourceClipProject,
  spanId: string,
  id: string,
): SourceClipPatch | undefined {
  const span = current.sourceSpans.find((item) => item.id === spanId);
  if (!span) {
    return undefined;
  }

  return placeSourceSpans(
    current,
    current.sourceSpans,
    [{ ...span, id, startQ: getClipEndQ(span, current.bpm) }],
    [[sourceClipEffectTrackId(spanId), sourceClipEffectTrackId(id)]],
  );
}

/**
 * Source clip `spanId` split at `splitQ` into itself and a new clip `id`
 * that plays on from where it stops, with a copy of its stack. Arrangement
 * clips keep showing the same content, now from the two pieces. Undefined
 * unless `splitQ` is inside the clip.
 */
export function splitSourceSpan(
  current: SourceClipProject,
  spanId: string,
  splitQ: number,
  id: string,
): SourceClipPatch | undefined {
  const { bpm } = current;
  const span = current.sourceSpans.find((item) => item.id === spanId);
  if (!span) {
    return undefined;
  }

  const endQ = getClipEndQ(span, bpm);
  if (!canSplitAt(span.startQ, endQ, splitQ)) {
    return undefined;
  }

  const left = retimeSourceSpan(span, span.startQ, splitQ - span.startQ, bpm);
  const right = retimeSourceSpan({ ...span, id }, splitQ, endQ - splitQ, bpm);
  const sourceSpans = current.sourceSpans.flatMap((item) =>
    item.id === spanId ? [left, right] : [item],
  );
  return {
    sourceSpans,
    clips: syncClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      sourceSpans,
      bpm,
    ),
    effects: copyEffectStacks(current.effects, [
      [sourceClipEffectTrackId(spanId), sourceClipEffectTrackId(id)],
    ]),
  };
}

/**
 * Source clip `spanId` removed. Arrangement clips stay where they are; the
 * parts of them it filled show nothing until something fills them again.
 */
export function deleteSourceSpan(
  current: SourceClipProject,
  spanId: string,
): SourceClipPatch | undefined {
  if (!current.sourceSpans.some((item) => item.id === spanId)) {
    return undefined;
  }

  const sourceSpans = current.sourceSpans.filter((item) => item.id !== spanId);
  return {
    sourceSpans,
    clips: syncClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      sourceSpans,
      current.bpm,
    ),
  };
}

export const NEW_MIDI_CLIP_LABEL = "MIDI clip";

const EPSILON_Q = 1e-6;

/**
 * How long a new MIDI clip at `startQ` in source track `trackId` can be: up
 * to `maxDurationQ`, ending where the next clip in the track begins. Zero
 * when `startQ` lies inside a clip or at its start.
 */
export function fitMidiClipDurationQ(
  current: Pick<SourceClipProject, "bpm" | "sourceSpans">,
  trackId: string,
  startQ: number,
  maxDurationQ: number,
) {
  let endQ = startQ + maxDurationQ;
  for (const item of current.sourceSpans) {
    if (item.sourceTrackId !== trackId) {
      continue;
    }
    if (item.startQ <= startQ + EPSILON_Q) {
      if (getClipEndQ(item, current.bpm) > startQ + EPSILON_Q) {
        return 0;
      }
    } else {
      endQ = Math.min(endQ, item.startQ);
    }
  }
  return Math.max(0, endQ - startQ);
}

/**
 * An empty MIDI clip `id`, up to `maxDurationQ` long, placed in source track
 * `trackId` at `startQ` and ending where the next clip there begins (see
 * fitMidiClipDurationQ). A default Synth leads its own stack and plays
 * the notes the piano roll adds to it, through the Gain at 0 dB it gets as
 * a media clip does, since a clip makes sound only through Gain; it gets no
 * Arpeggiator. Undefined without the track or without room at `startQ`.
 */
export function createMidiClip(
  current: SourceClipProject,
  trackId: string,
  startQ: number,
  maxDurationQ: number,
  id: string,
): SourceClipPatch | undefined {
  const track = current.sourceTracks.find((item) => item.id === trackId);
  if (!track) {
    return undefined;
  }

  const atQ = Math.max(0, startQ);
  const durationQ = fitMidiClipDurationQ(current, trackId, atQ, maxDurationQ);
  if (durationQ <= 0) {
    return undefined;
  }

  const swatch = getSwatch(track.colorIndex);
  const patch = placeSourceSpans(
    current,
    current.sourceSpans,
    [
      {
        id,
        sourceTrackId: trackId,
        label: NEW_MIDI_CLIP_LABEL,
        mediaPath: "",
        startQ: atQ,
        durationSeconds: quartersToSeconds(durationQ, current.bpm),
        trimStartSeconds: 0,
        notes: [],
        midiTimeline: newMidiTimeline(durationQ),
        tint: swatch.color,
        accent: swatch.accent,
      },
    ],
    [],
  );
  return {
    ...patch,
    effects: addDefaultSynth(
      addDefaultGain(
        patch.effects ?? current.effects,
        {
          sourceSpans: [{ id }],
        },
        [],
      ),
      id,
    ),
  };
}
