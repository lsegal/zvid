// Turning a finished recording pass into session media: each take becomes a
// media item and a clip on its track where recording started, the same way
// dropped media does, in one project change so one undo removes them all.
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import type { MediaItem } from "../media.ts";
import { addMediaToSourceTrack } from "../source-track-media.ts";

export type PlacedTake = {
  trackId: string;
  item: MediaItem;
  // Where recording started, in quarters.
  startQ: number;
};

/**
 * Adds every take's media item to the session and a clip of it at its start
 * on its track, overwriting what it lands on. Takes whose track is gone are
 * left out.
 */
export function addRecordedTakes(
  current: ProjectState,
  takes: readonly PlacedTake[],
): ProjectState {
  let next = current;
  const added: MediaItem[] = [];
  for (const take of takes) {
    if (!next.sourceTracks.some((track) => track.id === take.trackId)) {
      continue;
    }
    // A take lands where it was recorded, even on locked source tracks.
    const placed = addMediaToSourceTrack(
      { ...next, sourceTracksLocked: false },
      [take.item],
      { kind: "track", trackId: take.trackId, startQ: take.startQ },
    );
    next = { ...next, ...placed };
    added.push(take.item);
  }
  if (!added.length) {
    return current;
  }
  return patchProjectState(current, {
    mediaItems: [...current.mediaItems, ...added],
    sourceTracks: next.sourceTracks,
    sourceSpans: next.sourceSpans,
    clips: next.clips,
    effects: next.effects,
  });
}

/** The take's file name: its track's name and when the pass started. */
export function recordedTakeFileName(
  trackName: string,
  startedAt: Date,
  extension: string,
) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())} ${pad(startedAt.getHours())}.${pad(startedAt.getMinutes())}.${pad(startedAt.getSeconds())}`;
  const name = trackName.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Recording";
  return `${name} ${stamp}.${extension}`;
}

/**
 * The length an analyzed take reports, or the recorded length when its file
 * reports none: MediaRecorder files often carry no duration.
 */
export function withRecordedDuration(
  item: MediaItem,
  recordedSeconds: number,
): MediaItem {
  return Number.isFinite(item.durationSeconds) && item.durationSeconds > 0
    ? item
    : { ...item, durationSeconds: recordedSeconds };
}

/**
 * Rewrites a MediaRecorder file with a duration and a seek index, which
 * MediaRecorder leaves out, without re-encoding. Returns the original when
 * it can't be rewritten.
 */
export async function remuxRecording(blob: Blob): Promise<Blob> {
  try {
    const {
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      Conversion,
      Input,
      Mp4OutputFormat,
      Output,
      WebMOutputFormat,
    } = await import("mediabunny");
    const mp4 = /mp4/i.test(blob.type);
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    });
    const target = new BufferTarget();
    const output = new Output({
      format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
      target,
    });
    const conversion = await Conversion.init({ input, output });
    if (!conversion.isValid) {
      return blob;
    }
    await conversion.execute();
    return target.buffer
      ? new Blob([target.buffer], { type: blob.type })
      : blob;
  } catch (error) {
    console.warn("[zvid] Keeping the recording as recorded.", error);
    return blob;
  }
}
