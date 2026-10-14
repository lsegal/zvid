// Works out which clips are drawn at a playhead and the media time each is
// drawn at, without their effects. Media sync needs only this; the drawn
// frame adds each clip's effects to it (see computeActiveClips).
import { loopMediaTime, warpSourceTime } from "./clip-warp.ts";
import type {
  ActiveClip,
  ArrangementClip,
  MediaItem,
} from "./composition-active-clips.ts";
import {
  blendFrames,
  type FrameSpans,
  gridFrameSpans,
  type RetimeSettings,
  retimeSeconds,
  wrapMediaTime,
} from "./fx/effects/retime/retime.ts";
import { imageFrameSpans } from "./image-media-frames.ts";

export type ActiveClipTiming = Pick<
  ActiveClip,
  | "clip"
  | "media"
  | "sourceKey"
  | "mediaTime"
  | "playbackRate"
  | "isInBounds"
  | "laneRank"
  | "held"
  | "blend"
  | "retimed"
>;

// The clips Retime plays at another speed, by clip id, and the frame rate
// Blend counts a video's frames at when its own isn't known.
export type ClipRetimes = {
  byClip: ReadonlyMap<string, RetimeSettings>;
  frameRate: number;
};

// The second frame a Retime's Blend crossfades a clip's toward, drawn from
// the element `sourceKey` (a video's) or its media's frame at `mediaTime`,
// by `weight` (0..1).
export type RetimeBlend = {
  sourceKey: string;
  mediaTime: number;
  weight: number;
};

const NO_RETIMES: ClipRetimes = { byClip: new Map(), frameRate: 30 };

const EPSILON = 0.0001;
// A clip held on its last frame is drawn this long before its end, well
// inside its source window.
const HOLD_END_SECONDS = 0.001;

export function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

// At most one clip per lane under the playhead whose media is online, in
// lane order. While one of `transitions`, FX clips with a Transition, is
// under the playhead, the clips it blends between that aren't are drawn
// too, after the others: held on their last frame once they have ended, or
// their first before they start (see transitionHolds).
export function computeActiveClipTimings(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
  transitions: readonly ArrangementClip[] = [],
  retimes: ClipRetimes = NO_RETIMES,
): ActiveClipTiming[] {
  const live = liveClipTimings(
    clips,
    mediaById,
    playheadQ,
    bpm,
    lanePriority,
    retimes,
  );
  return transitions.length
    ? [
        ...live,
        ...transitionHolds(
          clips,
          mediaById,
          playheadQ,
          bpm,
          lanePriority,
          transitions,
          live,
          retimes,
        ),
      ]
    : live;
}

function liveClipTimings(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
  retimes: ClipRetimes = NO_RETIMES,
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
      const sourceKey = claimSourceKey(usedSourceKeys, media.id, clip);
      const retime = retimes.byClip.get(clip.id);
      return {
        clip,
        media,
        sourceKey,
        mediaTime,
        playbackRate,
        isInBounds:
          linearTime >= clip.sourceWindowStartSeconds &&
          linearTime < clip.sourceWindowEndSeconds - EPSILON &&
          mediaTime >= 0,
        laneRank,
        ...(retime &&
          retimedTiming(
            clip,
            media,
            sourceKey,
            warpedTime,
            playbackRate,
            bpm,
            retime,
            retimes.frameRate,
          )),
      };
    });
}

// Where a clip `retime` plays at another speed is drawn, given where it
// would be (`warpedTime`, at `rate`): its media time scaled around the time
// its start is drawn at and looped through its media. With Blend, it is
// drawn at the middle of the source frame that time falls in, a video's
// counted at its own frame rate, crossfaded toward the next one. A video
// plays at the retimed rate; one that runs backwards, stands still or
// blends is seeked to each frame instead.
function retimedTiming(
  clip: ArrangementClip,
  media: MediaItem,
  sourceKey: string,
  warpedTime: number,
  rate: number,
  bpm: number,
  retime: RetimeSettings,
  frameRate: number,
): Pick<ActiveClipTiming, "mediaTime" | "playbackRate" | "blend" | "retimed"> {
  const startLinear =
    quartersToSeconds(clip.layerClipStartQ ?? clip.startQ, bpm) +
    clip.sourceOffsetSeconds;
  const anchor = clip.warp
    ? warpSourceTime(clip.warp, startLinear, bpm).seconds
    : startLinear;
  const seconds = wrapMediaTime(
    retimeSeconds(warpedTime, anchor, retime.speed),
    media.durationSeconds,
  );
  const spans: FrameSpans | undefined =
    retime.interpolation !== "Blend"
      ? undefined
      : media.kind === "video"
        ? gridFrameSpans(seconds, media.fps || frameRate)
        : imageFrameSpans(media, seconds);
  if (!spans) {
    return {
      mediaTime: seconds,
      playbackRate: rate * retime.speed,
      retimed: true,
    };
  }
  const { from, to, weight } = blendFrames(seconds, spans);
  return {
    mediaTime: wrapMediaTime(from, media.durationSeconds),
    playbackRate: 0,
    retimed: true,
    blend: {
      sourceKey: `${sourceKey}~blend`,
      mediaTime: wrapMediaTime(to, media.durationSeconds),
      weight,
    },
  };
}

// `timings` and, after each a Retime blends, its blend frame's element at
// that frame's time, standing still: every media element they draw from.
export function mediaSourceTimings<T extends ActiveClipTiming>(
  timings: readonly T[],
): readonly T[] {
  if (!timings.some((timing) => timing.blend)) {
    return timings;
  }
  return timings.flatMap((timing) =>
    timing.blend
      ? [
          timing,
          {
            ...timing,
            sourceKey: timing.blend.sourceKey,
            mediaTime: timing.blend.mediaTime,
            blend: undefined,
          },
        ]
      : [timing],
  );
}

function clipEndQ(clip: ArrangementClip, bpm: number) {
  return clip.startQ + (clip.durationSeconds * bpm) / 60;
}

// The clips a Transition FX clip blends between: those drawn on the layers
// beneath it at its start (comp A, `outgoing`) and just before its end
// (comp B, `incoming`). They depend only on the arrangement, so they are
// worked out once per arrangement and Transition.
export function transitionCompTimings(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  transition: ArrangementClip,
  bpm: number,
  lanePriority: Map<string, number>,
) {
  const cached = transitionCompsCache.get(transition);
  if (
    cached?.clips === clips &&
    cached.mediaById === mediaById &&
    cached.bpm === bpm &&
    cached.lanePriority === lanePriority
  ) {
    return cached.comps;
  }

  const rank = lanePriority.get(transition.laneId) ?? -1;
  const beneathAt = (playheadQ: number) =>
    liveClipTimings(clips, mediaById, playheadQ, bpm, lanePriority).filter(
      (timing) => timing.laneRank > rank,
    );
  const comps = {
    outgoing: beneathAt(transition.startQ),
    incoming: beneathAt(clipEndQ(transition, bpm) - EPSILON * 2),
  };
  transitionCompsCache.set(transition, {
    clips,
    mediaById,
    bpm,
    lanePriority,
    comps,
  });
  return comps;
}

const transitionCompsCache = new WeakMap<
  ArrangementClip,
  {
    clips: ArrangementClip[];
    mediaById: Map<string, MediaItem>;
    bpm: number;
    lanePriority: Map<string, number>;
    comps: { outgoing: ActiveClipTiming[]; incoming: ActiveClipTiming[] };
  }
>();

// The clips the `transitions` under the playhead blend between that aren't
// `live`: each held on the frame nearest the playhead, its last once it has
// ended and its first before it starts, from a media element of its own.
function transitionHolds(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
  transitions: readonly ArrangementClip[],
  live: readonly ActiveClipTiming[],
  retimes: ClipRetimes,
) {
  const drawn = new Set(live.map((timing) => timing.clip.id));
  const holds: ActiveClipTiming[] = [];
  for (const transition of transitions) {
    if (
      playheadQ < transition.startQ - EPSILON ||
      playheadQ >= clipEndQ(transition, bpm) - EPSILON
    ) {
      continue;
    }
    const { outgoing, incoming } = transitionCompTimings(
      clips,
      mediaById,
      transition,
      bpm,
      lanePriority,
    );
    for (const { clip } of [...outgoing, ...incoming]) {
      if (drawn.has(clip.id)) {
        continue;
      }
      drawn.add(clip.id);
      const heldQ = Math.max(
        clip.startQ,
        Math.min(
          playheadQ,
          clipEndQ(clip, bpm) - (HOLD_END_SECONDS * bpm) / 60,
        ),
      );
      const [timing] = liveClipTimings(
        [clip],
        mediaById,
        heldQ,
        bpm,
        lanePriority,
        retimes,
      );
      if (timing) {
        const sourceKey = isGeneratedClip(clip)
          ? timing.sourceKey
          : `${timing.media.id}@held/${clip.id}`;
        holds.push({
          ...timing,
          sourceKey,
          ...(timing.blend && {
            blend: { ...timing.blend, sourceKey: `${sourceKey}~blend` },
          }),
          held: true,
        });
      }
    }
  }
  return holds;
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
