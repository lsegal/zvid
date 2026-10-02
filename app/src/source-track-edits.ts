// Pure edits to a project's source tracks: add, duplicate, delete, reorder
// and rename. A source track owns the source spans whose `sourceTrackId` is its
// id, and the arrangement clips cut from those spans depend on them, so
// deleting a track takes both. Each helper returns the project itself when nothing
// changed so history commits can skip no-op edits.
import type { ProjectState, SourceTrack } from "./app/types.ts";
import { getSwatch } from "./app/util.ts";
import {
  copyEffectStacks,
  pruneClipEffects,
  pruneSourceEffects,
  type SessionEffect,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./fx-stack.ts";
import {
  nextSourceTrackColorIndex,
  PALETTE_SIZE,
} from "./source-track-color.ts";

export type SourceTrackLike = { id: string; name: string; colorIndex: number };
export type SourceTrackSpan = {
  id: string;
  sourceTrackId: string;
  tint: string;
  accent: string;
};
export type SourceTrackClip = {
  id: string;
  sourceSpanId: string;
  sourceTrackId: string;
};

export type SourceTrackProject<
  Track extends SourceTrackLike,
  Span extends SourceTrackSpan,
  Clip extends SourceTrackClip,
> = {
  sourceTracks: Track[];
  sourceSpans: Span[];
  clips: Clip[];
  effects: SessionEffect[];
};

/**
 * The color for a copy of the track with color `colorIndex`: the next one
 * after it that no track in `tracks` uses, or simply the next one when every
 * color is taken.
 */
export function nextFreeSourceTrackColorIndex(
  tracks: readonly { colorIndex: number }[],
  colorIndex: number,
) {
  const start = Math.abs(colorIndex) % PALETTE_SIZE;
  const used = new Set(
    tracks.map((track) => Math.abs(track.colorIndex) % PALETTE_SIZE),
  );
  for (let step = 1; step <= PALETTE_SIZE; step += 1) {
    const candidate = (start + step) % PALETTE_SIZE;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return (start + 1) % PALETTE_SIZE;
}

/**
 * Adds a copy of source track `trackId` directly below it, named
 * "<name> copy" in the next free color, with copies of its spans pointing at
 * the same media, and copies of the track's and its spans' effect stacks.
 * `newTrackId` is the copy's id and `createSpanId` gives each copied span a
 * fresh id. Arrangement clips are unchanged. Unchanged when the track is
 * missing.
 */
export function duplicateSourceTrack<
  Track extends SourceTrackLike,
  Span extends SourceTrackSpan,
  Clip extends SourceTrackClip,
>(
  project: SourceTrackProject<Track, Span, Clip>,
  trackId: string,
  newTrackId: string,
  createSpanId: () => string,
): SourceTrackProject<Track, Span, Clip> {
  const index = project.sourceTracks.findIndex((track) => track.id === trackId);
  if (index < 0) {
    return project;
  }

  const source = project.sourceTracks[index];
  const colorIndex = nextFreeSourceTrackColorIndex(
    project.sourceTracks,
    source.colorIndex,
  );
  const copy: Track = {
    ...source,
    id: newTrackId,
    name: `${source.name} copy`,
    colorIndex,
  };
  const swatch = getSwatch(colorIndex);
  const stackCopies: [string, string][] = [
    [sourceTrackEffectTrackId(trackId), sourceTrackEffectTrackId(newTrackId)],
  ];
  const copiedSpans = project.sourceSpans
    .filter((span) => span.sourceTrackId === trackId)
    .map((span) => {
      const copied = {
        ...span,
        id: createSpanId(),
        sourceTrackId: newTrackId,
        tint: swatch.color,
        accent: swatch.accent,
      };
      stackCopies.push([
        sourceClipEffectTrackId(span.id),
        sourceClipEffectTrackId(copied.id),
      ]);
      return copied;
    });

  return {
    ...project,
    sourceTracks: [
      ...project.sourceTracks.slice(0, index + 1),
      copy,
      ...project.sourceTracks.slice(index + 1),
    ],
    sourceSpans: [...project.sourceSpans, ...copiedSpans],
    effects: copyEffectStacks(project.effects, stackCopies),
  };
}

/**
 * Removes source track `trackId` with its spans and the arrangement clips
 * cut from them, along with the track's, its spans' and those clips' own
 * effect stacks. The media stays in the library. Unchanged when the track is
 * missing.
 */
export function deleteSourceTrack<
  Track extends SourceTrackLike,
  Span extends SourceTrackSpan,
  Clip extends SourceTrackClip,
>(
  project: SourceTrackProject<Track, Span, Clip>,
  trackId: string,
): SourceTrackProject<Track, Span, Clip> {
  if (!project.sourceTracks.some((track) => track.id === trackId)) {
    return project;
  }

  const removedSpanIds = new Set(
    project.sourceSpans
      .filter((span) => span.sourceTrackId === trackId)
      .map((span) => span.id),
  );
  const clips = project.clips.filter(
    (clip) =>
      clip.sourceTrackId !== trackId && !removedSpanIds.has(clip.sourceSpanId),
  );
  const sourceTracks = project.sourceTracks.filter(
    (track) => track.id !== trackId,
  );
  const sourceSpans = project.sourceSpans.filter(
    (span) => span.sourceTrackId !== trackId,
  );
  return {
    ...project,
    sourceTracks,
    sourceSpans,
    clips,
    effects: pruneSourceEffects(
      pruneClipEffects(project.effects, clips),
      sourceTracks,
      sourceSpans,
    ),
  };
}

/**
 * Moves source track `trackId` so it ends up at `targetIndex` (clamped to
 * the list). Its id and spans stay the same. Unchanged when it is already
 * there or missing.
 */
export function moveSourceTrackTo<
  Track extends SourceTrackLike,
  Span extends SourceTrackSpan,
  Clip extends SourceTrackClip,
>(
  project: SourceTrackProject<Track, Span, Clip>,
  trackId: string,
  targetIndex: number,
): SourceTrackProject<Track, Span, Clip> {
  const index = project.sourceTracks.findIndex((track) => track.id === trackId);
  const target = Math.max(
    0,
    Math.min(project.sourceTracks.length - 1, Math.trunc(targetIndex)),
  );
  if (index < 0 || Number.isNaN(target) || target === index) {
    return project;
  }

  const sourceTracks = [...project.sourceTracks];
  const [track] = sourceTracks.splice(index, 1);
  sourceTracks.splice(target, 0, track);
  return { ...project, sourceTracks };
}

/**
 * Renames source track `trackId` to `name`, trimmed, along with its spans'
 * labels and the labels of the arrangement clips cut from it that still
 * carry the old track name; clips named on their own keep their names.
 * Unchanged when the track is missing, the name is empty, or it is the same.
 */
export function renameSourceTrack<
  Track extends SourceTrackLike,
  Span extends SourceTrackSpan & { label: string },
  Clip extends SourceTrackClip & { label: string },
>(
  project: SourceTrackProject<Track, Span, Clip>,
  trackId: string,
  name: string,
): SourceTrackProject<Track, Span, Clip> {
  const trimmed = name.trim();
  const track = project.sourceTracks.find((item) => item.id === trackId);
  if (!track || !trimmed || trimmed === track.name) {
    return project;
  }

  return {
    ...project,
    sourceTracks: project.sourceTracks.map((item) =>
      item.id === trackId ? { ...item, name: trimmed } : item,
    ),
    sourceSpans: project.sourceSpans.map((span) =>
      span.sourceTrackId === trackId ? { ...span, label: trimmed } : span,
    ),
    clips: project.clips.map((clip) =>
      clip.sourceTrackId === trackId && clip.label === track.name
        ? { ...clip, label: trimmed }
        : clip,
    ),
  };
}

/**
 * The name for a new empty source track: "Source Track N", N one more than
 * the number of tracks, or the next number no track is already named with.
 */
export function getNextSourceTrackName(tracks: readonly { name: string }[]) {
  let number = tracks.length + 1;
  while (tracks.some((track) => track.name === `Source Track ${number}`)) {
    number += 1;
  }

  return `Source Track ${number}`;
}

/**
 * Adds an empty source track `trackId` named `name` after the others, in the
 * color after the last track's, like a track media is dropped into.
 */
export function addEmptySourceTrack(
  project: Pick<ProjectState, "sourceTracks">,
  trackId: string,
  name: string,
): Pick<ProjectState, "sourceTracks"> {
  const track: SourceTrack = {
    id: trackId,
    name,
    colorIndex: nextSourceTrackColorIndex(project.sourceTracks),
    recordingPaths: [],
  };
  return { sourceTracks: [...project.sourceTracks, track] };
}
