// What the compositor renders. Normally that is the arrangement's layer
// clips; when there are none at all, the source tracks render as if they
// were layers instead, so a session with only source tracks still previews
// and exports. Preview, the transform overlay and export all resolve their
// clips here, so they always agree.
import { quartersToSeconds } from "./app/timeline-math.ts";
import type {
  ArrangementClip,
  Lane,
  SourceSpan,
  SourceTrack,
} from "./app/types.ts";

// Virtual ids are namespaced so they never collide with real clips or
// layers, and never pick up a stored layer or clip effect stack: only the
// Global stack applies to them.
export const SOURCE_RENDER_ID_PREFIX = "source-render:";

export type RenderClipsInputs = {
  clips: ArrangementClip[];
  lanes: Lane[];
  sourceTracks: SourceTrack[];
  sourceSpans: SourceSpan[];
  bpm: number;
};

export type RenderClips = {
  clips: ArrangementClip[];
  lanes: Lane[];
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

// The clips and layers to render. With any arrangement clip, those pass
// through unchanged. With none, each source span becomes a clip playing its
// media at its timeline position, on one layer per source track in source
// track order (source track 1 on top, as Layer 1 is).
export function resolveRenderClips({
  clips,
  lanes,
  sourceTracks,
  sourceSpans,
  bpm,
}: RenderClipsInputs): RenderClips {
  if (clips.length || !sourceSpans.length) {
    return { clips, lanes, fromSourceTracks: false };
  }

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
    }),
  );

  const virtualClips = sourceSpans.map((span): ArrangementClip => {
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

  return { clips: virtualClips, lanes: virtualLanes, fromSourceTracks: true };
}
