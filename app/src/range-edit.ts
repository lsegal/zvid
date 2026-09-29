// Cutting, copying, deleting and pasting a span of the arrangement, and the
// clip timing and overlap rules they share with moving and splitting clips.
//
// A clip plays its source at the song time plus its source offset, and a
// warped clip maps that same linear position through its warp markers. So a
// piece of a clip keeps its source offset wherever the piece starts, and a
// clip moved to a new start changes its offset to keep playing the same
// source: warped or not, both play exactly what the original did.

// Edges closer than this count as touching, not overlapping.
const EPSILON = 0.0001;

/** The clip fields range edits read and change. */
export type RangeClip = {
  id: string;
  laneId: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  sourceOffsetSeconds: number;
};

/** A piece of copied content, `offsetQ` quarters after the copy's start. */
export type ClipboardFragment<Clip extends RangeClip> = {
  clip: Clip;
  offsetQ: number;
};

/**
 * What Cut or Copy put on the clipboard: the pieces of one layer's content
 * in a span `durationQ` quarters long, in timeline order. A copied clip is
 * one fragment at offset 0.
 */
export type ClipboardContent<Clip extends RangeClip> = {
  fragments: ClipboardFragment<Clip>[];
  durationQ: number;
};

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

function getClipEndQ(clip: RangeClip, bpm: number) {
  return clip.startQ + (clip.durationSeconds * bpm) / 60;
}

/**
 * `clip` shown from `startQ` for `durationQ` quarters, optionally on another
 * layer, playing the same source position at each point in time.
 */
export function withWindowTiming<Clip extends RangeClip>(
  clip: Clip,
  startQ: number,
  durationQ: number,
  bpm: number,
  laneId = clip.laneId,
): Clip {
  return {
    ...clip,
    laneId,
    startQ,
    durationSeconds: quartersToSeconds(durationQ, bpm),
    trimStartSeconds: quartersToSeconds(startQ, bpm) + clip.sourceOffsetSeconds,
  };
}

/**
 * Places `activeClip` and trims the clips it overlaps on its layer: each
 * keeps its longer uncovered side, and is removed when it has none.
 */
export function resolveClipOverlaps<Clip extends RangeClip>(
  clips: Clip[],
  activeClip: Clip,
  bpm: number,
) {
  const activeEndQ = getClipEndQ(activeClip, bpm);

  return clips.flatMap<Clip>((clip) => {
    if (clip.id === activeClip.id) {
      return [activeClip];
    }

    if (clip.laneId !== activeClip.laneId) {
      return [clip];
    }

    const clipEndQ = getClipEndQ(clip, bpm);
    const overlapStartQ = Math.max(activeClip.startQ, clip.startQ);
    const overlapEndQ = Math.min(activeEndQ, clipEndQ);
    if (overlapEndQ - overlapStartQ <= EPSILON) {
      return [clip];
    }

    const leftDurationQ = Math.max(0, activeClip.startQ - clip.startQ);
    const rightDurationQ = Math.max(0, clipEndQ - activeEndQ);

    if (leftDurationQ <= EPSILON && rightDurationQ <= EPSILON) {
      return [];
    }

    if (leftDurationQ >= rightDurationQ && leftDurationQ > EPSILON) {
      return [withWindowTiming(clip, clip.startQ, leftDurationQ, bpm)];
    }

    if (rightDurationQ > EPSILON) {
      return [withWindowTiming(clip, activeEndQ, rightDurationQ, bpm)];
    }

    return [];
  });
}

/**
 * The part of `clip` inside `[startQ, endQ)`, or `null` when it has none.
 * The part keeps its source offset, so it plays what the clip played there.
 */
export function sliceClipToRange<Clip extends RangeClip>(
  clip: Clip,
  startQ: number,
  endQ: number,
  bpm: number,
): Clip | null {
  const sliceStartQ = Math.max(clip.startQ, startQ);
  const sliceEndQ = Math.min(getClipEndQ(clip, bpm), endQ);
  if (sliceEndQ - sliceStartQ <= EPSILON) {
    return null;
  }

  return withWindowTiming(clip, sliceStartQ, sliceEndQ - sliceStartQ, bpm);
}

/**
 * Removes the content in `[startQ, endQ)` on layer `laneId`: clips inside it
 * are removed, clips over one edge are trimmed to the part outside it, and a
 * clip over both edges is split in two around the gap, its right piece taking
 * the id `createId` returns for it. Other layers are unchanged, and nothing
 * moves to close the gap.
 */
export function removeRangeFromLane<Clip extends RangeClip>(
  clips: readonly Clip[],
  laneId: string,
  startQ: number,
  endQ: number,
  bpm: number,
  createId: (source: Clip) => string,
): Clip[] {
  return clips.flatMap<Clip>((clip) => {
    if (clip.laneId !== laneId) {
      return [clip];
    }

    const clipEndQ = getClipEndQ(clip, bpm);
    if (Math.min(clipEndQ, endQ) - Math.max(clip.startQ, startQ) <= EPSILON) {
      return [clip];
    }

    const leftDurationQ = startQ - clip.startQ;
    const rightDurationQ = clipEndQ - endQ;
    const hasLeft = leftDurationQ > EPSILON;
    const hasRight = rightDurationQ > EPSILON;
    return [
      ...(hasLeft
        ? [withWindowTiming(clip, clip.startQ, leftDurationQ, bpm)]
        : []),
      ...(hasRight
        ? [
            withWindowTiming(
              hasLeft ? { ...clip, id: createId(clip) } : clip,
              endQ,
              rightDurationQ,
              bpm,
            ),
          ]
        : []),
    ];
  });
}

/**
 * The content in `[startQ, endQ)` on layer `laneId`, each clip trimmed to the
 * range and placed relative to its start. It has no fragments when the range
 * is empty.
 */
export function copyRange<Clip extends RangeClip>(
  clips: readonly Clip[],
  laneId: string,
  startQ: number,
  endQ: number,
  bpm: number,
): ClipboardContent<Clip> {
  const fragments = clips
    .filter((clip) => clip.laneId === laneId)
    .flatMap((clip) => {
      const slice = sliceClipToRange(clip, startQ, endQ, bpm);
      return slice ? [{ clip: slice, offsetQ: slice.startQ - startQ }] : [];
    })
    .toSorted((a, b) => a.offsetQ - b.offsetQ);
  return { fragments, durationQ: Math.max(0, endQ - startQ) };
}

/** A whole clip as clipboard content: one fragment at offset 0. */
export function copyClip<Clip extends RangeClip>(
  clip: Clip,
  bpm: number,
): ClipboardContent<Clip> {
  return {
    fragments: [{ clip: { ...clip }, offsetQ: 0 }],
    durationQ: getClipEndQ(clip, bpm) - clip.startQ,
  };
}

/**
 * `clip` moved to start at `startQ` on layer `laneId` with id `id`, still
 * playing the same source from its start.
 */
export function placeClipAt<Clip extends RangeClip>(
  clip: Clip,
  laneId: string,
  startQ: number,
  bpm: number,
  id: string,
): Clip {
  return {
    ...clip,
    id,
    laneId,
    startQ,
    sourceOffsetSeconds: clip.trimStartSeconds - quartersToSeconds(startQ, bpm),
  };
}

/**
 * Pastes `content` on layer `laneId` from `pasteQ`, keeping its fragments'
 * spacing. Each pasted clip overwrites what it covers there, as a clip moved
 * onto others does. Returns the new clips and the pasted ones, in order.
 */
export function pasteClipboard<Clip extends RangeClip>(
  clips: readonly Clip[],
  content: ClipboardContent<Clip>,
  laneId: string,
  pasteQ: number,
  bpm: number,
  createId: () => string,
) {
  const pasted: Clip[] = [];
  let nextClips = [...clips];
  for (const fragment of content.fragments) {
    const clip = placeClipAt(
      fragment.clip,
      laneId,
      pasteQ + fragment.offsetQ,
      bpm,
      createId(),
    );
    nextClips = resolveClipOverlaps([...nextClips, clip], clip, bpm);
    pasted.push(clip);
  }
  return { clips: nextClips, pasted };
}
