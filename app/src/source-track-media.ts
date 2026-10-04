import type {
  ProjectState,
  SourceSpan,
  SourceTrack,
  SourceTrackDropTarget,
} from "./app/types.ts";
import { getSwatch, stripFilenameExtension } from "./app/util.ts";
import { addDefaultGain } from "./default-gain.ts";
import { isImageMedia, type MediaItem } from "./media.ts";
import { mediaRangeOf } from "./media-range.ts";
import {
  getDroppedSourceSpanStartQ,
  placeDroppedSourceSpans,
} from "./source-span-edit.ts";
import { nextSourceTrackColorIndex } from "./source-track-color.ts";

// The shortest clip media without In/Out points makes, so media that has not
// reported a duration yet still shows up.
const MIN_UNRANGED_CLIP_SECONDS = 1;

/**
 * The part of `item` a clip of it plays: its In/Out range, or the whole file
 * (at least a second) when it has none.
 */
export function getMediaClipTrim(item: MediaItem) {
  const range = mediaRangeOf(item);
  return range
    ? {
        trimStartSeconds: range.inSeconds,
        durationSeconds: range.outSeconds - range.inSeconds,
      }
    : {
        trimStartSeconds: 0,
        durationSeconds: Math.max(
          MIN_UNRANGED_CLIP_SECONDS,
          item.durationSeconds,
        ),
      };
}

export type SourceTrackMediaPlacement = Pick<
  ProjectState,
  "sourceTracks" | "sourceSpans" | "clips" | "effects"
>;

/**
 * Adds a clip of each of `items` to the source track `target` names, or to a
 * new track named after the first item, pre-trimmed to its In/Out range. The
 * clips go back to back from the drop position, overwriting what they land
 * on like a moved clip; on a locked track they go after its last clip.
 * Each clip of media with sound gets a Gain at 0 dB.
 */
export function addMediaToSourceTrack(
  current: Pick<
    ProjectState,
    | "sourceTracks"
    | "sourceSpans"
    | "clips"
    | "effects"
    | "sourceTracksLocked"
    | "bpm"
  >,
  allItems: readonly MediaItem[],
  target: SourceTrackDropTarget,
): SourceTrackMediaPlacement {
  // Images make no clips; they stay in the Media drawer for effects to use.
  const items = allItems.filter((item) => !isImageMedia(item));
  if (!items.length) {
    return {
      sourceTracks: current.sourceTracks,
      sourceSpans: current.sourceSpans,
      clips: current.clips,
      effects: current.effects,
    };
  }
  let targetTrack: SourceTrack | undefined =
    target.kind === "track"
      ? current.sourceTracks.find((track) => track.id === target.trackId)
      : undefined;
  const startQ = getDroppedSourceSpanStartQ(
    target,
    targetTrack !== undefined,
    current.sourceTracksLocked === true,
  );

  let sourceTracks = current.sourceTracks;
  if (!targetTrack) {
    targetTrack = {
      id: `source-track-${crypto.randomUUID()}`,
      name: stripFilenameExtension(items[0]?.name ?? "Source Track"),
      colorIndex: nextSourceTrackColorIndex(current.sourceTracks),
      recordingPaths: [],
    };
    sourceTracks = [...sourceTracks, targetTrack];
  }

  const trackId = targetTrack.id;
  const mediaPaths = items.map((item) => item.sourcePath ?? item.name);
  sourceTracks = sourceTracks.map((track) =>
    track.id === trackId
      ? {
          ...track,
          recordingPaths: [
            ...track.recordingPaths,
            ...mediaPaths.filter(
              (path, index) =>
                !track.recordingPaths.includes(path) &&
                mediaPaths.indexOf(path) === index,
            ),
          ],
        }
      : track,
  );

  const swatch = getSwatch(targetTrack.colorIndex);
  const droppedSpans = items.map<SourceSpan>((item) => ({
    id: `source-span-${crypto.randomUUID()}`,
    sourceTrackId: trackId,
    label: stripFilenameExtension(item.name),
    mediaPath: item.sourcePath ?? item.name,
    mediaId: item.id,
    startQ: 0,
    ...getMediaClipTrim(item),
    tint: swatch.color,
    accent: swatch.accent,
  }));
  const placed = placeDroppedSourceSpans(
    current.sourceSpans,
    current.clips,
    droppedSpans,
    startQ,
    current.bpm,
  );

  return {
    sourceTracks,
    sourceSpans: placed.sourceSpans,
    clips: placed.clips,
    effects: addDefaultGain(
      current.effects,
      { sourceSpans: droppedSpans },
      items,
    ),
  };
}
