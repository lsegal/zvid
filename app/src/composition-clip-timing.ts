// Works out which clips are drawn at a playhead and the media time each is
// drawn at, without their effects. Media sync needs only this; the drawn
// frame adds each clip's effects to it (see computeActiveClips).
import { loopMediaTime, warpSourceTime } from "./clip-warp.ts";
import type {
  ActiveClip,
  ArrangementClip,
  MediaItem,
} from "./composition-active-clips.ts";

export type ActiveClipTiming = Pick<
  ActiveClip,
  | "clip"
  | "media"
  | "sourceKey"
  | "mediaTime"
  | "playbackRate"
  | "isInBounds"
  | "laneRank"
>;

const EPSILON = 0.0001;

export function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

// At most one clip per lane under the playhead whose media is online, in
// lane order.
export function computeActiveClipTimings(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
): ActiveClipTiming[] {
  const usedSourceKeys = new Set<string>();

  // Offline or still-restoring media has nothing to draw, so its clip is
  // skipped and takes no band. It never hides the clips on other lanes.
  const drawable = clips
    .filter((clip) => {
      const clipEndQ = clip.startQ + (clip.durationSeconds * bpm) / 60;
      return (
        playheadQ >= clip.startQ - EPSILON && playheadQ < clipEndQ - EPSILON
      );
    })
    .map((clip) => ({
      clip,
      media: isGeneratedClip(clip)
        ? createGeneratedMedia(clip)
        : clip.mediaId
          ? mediaById.get(clip.mediaId)
          : undefined,
    }))
    .filter((entry): entry is { clip: ArrangementClip; media: MediaItem } =>
      Boolean(isGeneratedClip(entry.clip) || entry.media?.previewUrl),
    );

  // A lane shows one clip at a time. Where clips on a lane overlap, the one
  // that starts latest is on top, as in Ableton; on a tie the later clip in
  // the arrangement wins.
  const topClipByLane = new Map<string, (typeof drawable)[number]>();
  for (const entry of drawable) {
    const current = topClipByLane.get(entry.clip.laneId);
    if (!current || entry.clip.startQ >= current.clip.startQ) {
      topClipByLane.set(entry.clip.laneId, entry);
    }
  }

  return [...topClipByLane.values()]
    .sort(
      (left, right) =>
        (lanePriority.get(left.clip.laneId) ?? Number.MAX_SAFE_INTEGER) -
        (lanePriority.get(right.clip.laneId) ?? Number.MAX_SAFE_INTEGER),
    )
    .map<ActiveClipTiming>(({ clip, media }) => {
      const laneRank = lanePriority.get(clip.laneId) ?? -1;
      if (isGeneratedClip(clip)) {
        return {
          clip,
          media,
          sourceKey: media.id,
          mediaTime: 0,
          playbackRate: 1,
          isInBounds: true,
          laneRank,
        };
      }

      // The source window is in linear source time; the media's own bounds
      // apply to the warped time the media is actually drawn at, which loops
      // back to the media's start past its end.
      const linearTime =
        quartersToSeconds(playheadQ, bpm) + clip.sourceOffsetSeconds;
      const { seconds: warpedTime, rate: playbackRate } = clip.warp
        ? warpSourceTime(clip.warp, linearTime, bpm)
        : { seconds: linearTime, rate: 1 };
      const mediaTime = loopMediaTime(warpedTime, media.durationSeconds);
      return {
        clip,
        media,
        sourceKey: claimSourceKey(usedSourceKeys, media.id, clip),
        mediaTime,
        playbackRate,
        isInBounds:
          linearTime >= clip.sourceWindowStartSeconds &&
          linearTime < clip.sourceWindowEndSeconds - EPSILON &&
          mediaTime >= 0,
        laneRank,
      };
    });
}

// Fill and text clips draw what their layer's effects describe rather than
// a media file, and FX clips adjust what is beneath them.
export function isGeneratedClip(clip: ArrangementClip) {
  return clip.kind === "fill" || clip.kind === "text" || clip.kind === "fx";
}

// Stands in for the media of a fill, text or FX clip, which has none. Its id
// doubles as the clip's source key, and the compositor never makes a media
// element for it.
function createGeneratedMedia(clip: ArrangementClip): MediaItem {
  return {
    id: `${clip.kind}:${clip.id}`,
    name: clip.label,
    kind: "video",
    durationSeconds: clip.durationSeconds,
    hasAudio: false,
    hasVideo: true,
    previewUrl: "",
  };
}

// The first clip using a media draws from the media's own element. Further
// clips on it get one element per lane, so a lane keeps reusing the same
// extra element from clip to clip.
function claimSourceKey(
  usedSourceKeys: Set<string>,
  mediaId: string,
  clip: ArrangementClip,
) {
  const candidates = [
    mediaId,
    `${mediaId}@${clip.laneId}`,
    `${mediaId}@${clip.laneId}/${clip.id}`,
  ];
  const sourceKey =
    candidates.find((candidate) => !usedSourceKeys.has(candidate)) ??
    candidates[candidates.length - 1];
  usedSourceKeys.add(sourceKey);
  return sourceKey;
}
