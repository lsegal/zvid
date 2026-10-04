// What the compositor renders. Normally that is the arrangement's layer
// clips, each media clip as the pieces of its source track window that hold
// a source clip, so the parts over nothing draw nothing; when there are none
// at all, the source tracks render as if they
// were layers instead, so a session with only source tracks still previews
// and exports. Preview, the transform overlay and export all resolve their
// clips, and the effects they render with, here, so they always agree.
//
// A hidden source track's video is drawn nowhere: neither the media clips
// that show it nor its own spans render. A hidden layer's clips are kept,
// marked `hidden`, so the compositor can still draw them into the mask of a
// layer whose Mask targets that layer, but nowhere else.
import { quartersToSeconds } from "./app/timeline-math.ts";
import type {
  ArrangementClip,
  Lane,
  SourceSpan,
  SourceTrack,
} from "./app/types.ts";
import {
  clipEffectTrackId,
  getEffectSourceSpanId,
  getEffectSourceTrackId,
} from "./fx/stack/clip-stacks.ts";
import { getClipPieceClips } from "./source-track-content.ts";

// Virtual ids are namespaced so they never collide with real clips or
// layers, and never pick up a stored layer or clip effect stack: besides
// the Global stack, only their source track's and source clip's own stacks
// apply to them (see resolveRenderEffects).
export const SOURCE_RENDER_ID_PREFIX = "source-render:";

type RenderEffect = { trackId: string };

export type RenderClipsInputs<Effect extends RenderEffect = RenderEffect> = {
  clips: ArrangementClip[];
  lanes: Lane[];
  sourceTracks: SourceTrack[];
  sourceSpans: SourceSpan[];
  bpm: number;
  effects: Effect[];
};

// A clip as the compositor draws it. A piece of a media layer clip keeps
// the whole clip's timing for its animations.
export type RenderClip = ArrangementClip & {
  layerClipStartQ?: number;
  layerClipDurationSeconds?: number;
  hidden?: boolean;
};

export type RenderClips<Effect extends RenderEffect = RenderEffect> = {
  clips: RenderClip[];
  lanes: Lane[];
  effects: Effect[];
  // Whether the clips are the source-track fallback rather than the
  // arrangement's own.
  fromSourceTracks: boolean;
};

export function sourceRenderLaneId(sourceTrackId: string) {
  return `${SOURCE_RENDER_ID_PREFIX}${sourceTrackId}`;
}

export function sourceRenderClipId(sourceSpanId: string) {
  return `${SOURCE_RENDER_ID_PREFIX}${sourceSpanId}`;
}

export function isSourceRenderId(id: string) {
  return id.startsWith(SOURCE_RENDER_ID_PREFIX);
}

// Whether there is anything to render: a layer clip, or else a source span.
export function hasRenderableContent({
  clips,
  sourceSpans,
}: Pick<RenderClipsInputs, "clips" | "sourceSpans">) {
  return clips.length > 0 || sourceSpans.length > 0;
}

// The clips and layers to render. With any arrangement clip, those render
// on their own layers: fill, text and FX clips as they are, and each media
// clip as one clip per source clip in its window (getClipPieceClips), each
// animating over the whole clip. With none, each source span becomes a clip playing its
// media at its timeline position, on one layer per source track in source
// track order (source track 1 on top, as Layer 1 is). Their source track
// and source clip stacks apply to them (see resolveRenderEffects).
export function resolveRenderClips<Effect extends RenderEffect>({
  clips,
  lanes,
  sourceTracks,
  sourceSpans,
  bpm,
  effects,
}: RenderClipsInputs<Effect>): RenderClips<Effect> {
  const hiddenTrackIds = new Set(
    sourceTracks.filter((track) => track.hidden).map((track) => track.id),
  );
  if (clips.length) {
    const hiddenLaneIds = new Set(
      lanes.filter((lane) => lane.hidden).map((lane) => lane.id),
    );
    return {
      clips: clips.flatMap((clip) => {
        if (!clip.kind && hiddenTrackIds.has(clip.sourceTrackId)) {
          return [];
        }
        const pieces = resolveLayerClipPieces(clip, sourceSpans, bpm);
        return hiddenLaneIds.has(clip.laneId)
          ? pieces.map((piece) => ({ ...piece, hidden: true }))
          : pieces;
      }),
      lanes,
      effects,
      fromSourceTracks: false,
    };
  }
  if (!sourceSpans.length) {
    return { clips, lanes, effects, fromSourceTracks: false };
  }
  const shownSpans = hiddenTrackIds.size
    ? sourceSpans.filter((span) => !hiddenTrackIds.has(span.sourceTrackId))
    : sourceSpans;

  // Spans on a track the session no longer lists still render, below the
  // listed tracks.
  const trackIds = sourceTracks.map((track) => track.id);
  for (const span of sourceSpans) {
    if (!trackIds.includes(span.sourceTrackId)) {
      trackIds.push(span.sourceTrackId);
    }
  }
  const trackById = new Map(sourceTracks.map((track) => [track.id, track]));
  const virtualLanes = trackIds.map(
    (trackId, index): Lane => ({
      id: sourceRenderLaneId(trackId),
      name: trackById.get(trackId)?.name ?? `Source ${index + 1}`,
      colorIndex: trackById.get(trackId)?.colorIndex ?? index,
      // The source track's FX switch bypasses its virtual layer, and so its
      // own and its clips' stacks (getRenderedEffects).
      ...(trackById.get(trackId)?.fxEnabled === false
        ? { fxEnabled: false }
        : {}),
    }),
  );

  const virtualClips = shownSpans.map((span): ArrangementClip => {
    const sourceOffsetSeconds =
      span.trimStartSeconds - quartersToSeconds(span.startQ, bpm);
    return {
      id: sourceRenderClipId(span.id),
      sourceSpanId: span.id,
      sourceTrackId: span.sourceTrackId,
      laneId: sourceRenderLaneId(span.sourceTrackId),
      label: span.label,
      mediaPath: span.mediaPath,
      mediaId: span.mediaId,
      startQ: span.startQ,
      durationSeconds: span.durationSeconds,
      trimStartSeconds: span.trimStartSeconds,
      sourceOffsetSeconds,
      sourceWindowStartSeconds: span.trimStartSeconds,
      sourceWindowEndSeconds: span.trimStartSeconds + span.durationSeconds,
      warp: span.warp,
      tint: span.tint,
      accent: span.accent,
    };
  });

  return {
    clips: virtualClips,
    lanes: virtualLanes,
    effects: resolveRenderEffects(effects),
    fromSourceTracks: true,
  };
}

// `clip` as the clips it renders as: itself, or the pieces of a media
// clip's source track window, each keeping the clip's timing.
function resolveLayerClipPieces(
  clip: ArrangementClip,
  sourceSpans: SourceSpan[],
  bpm: number,
): RenderClip[] {
  if (clip.kind) {
    return [clip];
  }
  return getClipPieceClips(clip, sourceSpans, bpm).map((piece) => ({
    ...piece,
    layerClipStartQ: clip.startQ,
    layerClipDurationSeconds: clip.durationSeconds,
  }));
}

// The effects source tracks render with in place of layers: each source
// track's stack becomes its virtual layer's and each source clip's its
// virtual clip's, so the compositor applies Global, then the track's, then
// the clip's stack, as it does for a layer clip. Returns `effects` itself
// when there are no source stacks.
export function resolveRenderEffects<Effect extends RenderEffect>(
  effects: Effect[],
) {
  let changed = false;
  const resolved = effects.map((effect) => {
    const sourceTrackId = getEffectSourceTrackId(effect.trackId);
    const sourceSpanId = getEffectSourceSpanId(effect.trackId);
    const trackId =
      sourceTrackId !== undefined
        ? sourceRenderLaneId(sourceTrackId)
        : sourceSpanId !== undefined
          ? clipEffectTrackId(sourceRenderClipId(sourceSpanId))
          : undefined;
    if (trackId === undefined) {
      return effect;
    }
    changed = true;
    return { ...effect, trackId };
  });
  return changed ? resolved : effects;
}
