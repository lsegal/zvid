import { createClipWarp } from "../clip-warp.ts";
import { createFillClip } from "../fill-clip.ts";
import { createFxClip } from "../fx-clip.ts";
import {
  ensureLayerLayouts,
  mapEffects,
  pruneClipEffects,
  pruneSourceEffects,
} from "../fx-stack.ts";
import type { MediaItem } from "../media.ts";
import {
  migrateClipContentEffects,
  migrateColorizeReactivity,
  migrateDefaultOrder,
  migrateOrderOuterMargin,
} from "../project-state-compat.ts";
import {
  formatOverlapNote,
  resolveSessionOverlaps,
} from "../selection-overlaps.ts";
import { clipSourceFrame, type LvpSession } from "../session.ts";
import { snapFrameRate } from "../session-format.ts";
import {
  readSelectionSlip,
  readSessionFills,
  readSessionFxClips,
  readSessionTexts,
  readWarpAnchorSeconds,
} from "../session-save.ts";
import {
  MIN_CANVAS_DIMENSION,
  readSessionEncoding,
} from "../session-settings.ts";
import {
  sessionSourceTrackColorIndex,
  sourceTrackColorIndex,
} from "../source-track-color.ts";
import { createTextClip } from "../text-clip.ts";
import { ZOOM_MAX, ZOOM_MIN } from "../zoom.ts";
import {
  DEFAULT_LANES,
  FILL_CLIP_ACCENT,
  FILL_CLIP_TINT,
} from "./constants.ts";
import {
  chooseSourceSpanForWindow,
  quartersToSeconds,
  secondsToQuarters,
} from "./timeline-math.ts";
import type {
  ArrangementClip,
  Lane,
  ProjectState,
  SourceSpan,
  SourceTrack,
} from "./types.ts";
import { basename, clamp, getSwatch, normalizeMediaPath } from "./util.ts";

export function mergeMediaItemsById(
  current: MediaItem[],
  incoming: MediaItem[],
) {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  return current.map((item) => incomingById.get(item.id) ?? item);
}

export function patchProjectState(
  current: ProjectState,
  patch: Partial<ProjectState>,
) {
  // Clips that are gone take their own effect stacks with them.
  if (patch.clips) {
    const effects = patch.effects ?? current.effects;
    const pruned = pruneClipEffects(effects, patch.clips);
    if (pruned !== effects) {
      patch = { ...patch, effects: pruned };
    }
  }
  // So do source tracks and source clips, such as a span an overlap
  // removed.
  if (patch.sourceTracks || patch.sourceSpans) {
    const effects = patch.effects ?? current.effects;
    const pruned = pruneSourceEffects(
      effects,
      patch.sourceTracks ?? current.sourceTracks,
      patch.sourceSpans ?? current.sourceSpans,
    );
    if (pruned !== effects) {
      patch = { ...patch, effects: pruned };
    }
  }

  let changed = false;
  const next = { ...current };

  for (const [rawKey, value] of Object.entries(patch) as Array<
    [keyof ProjectState, ProjectState[keyof ProjectState]]
  >) {
    if (Object.is(current[rawKey], value)) {
      continue;
    }

    changed = true;
    (next as ProjectState)[rawKey] = value as never;
  }

  return changed ? next : current;
}

export function pickMediaByPath(
  items: MediaItem[],
  rawPath: string | undefined,
) {
  if (!rawPath?.trim()) {
    return undefined;
  }

  const normalizedTarget = normalizeMediaPath(rawPath);
  const exactMatch = items.find(
    (item) =>
      item.sourcePath &&
      normalizeMediaPath(item.sourcePath) === normalizedTarget,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const targetBase = basename(rawPath).toLowerCase();
  return items.find((item) => item.name.toLowerCase() === targetBase);
}

export function sessionToProject(
  loadedSession: LvpSession,
  mediaItems: MediaItem[],
) {
  // Stacked clips on one layer would hide all but the top one.
  const { session, ...overlaps } = resolveSessionOverlaps(loadedSession);
  const bpm = session.timeline?.bpm ?? 120;
  const fps = session.timeline?.fps ?? 30;
  const lanes = (session.mainTracks ?? DEFAULT_LANES).map<Lane>((track) => ({
    id: track.id,
    name: track.name,
    colorIndex: track.colorIndex ?? -1,
    ...(track.fxEnabled === false ? { fxEnabled: false } : {}),
  }));
  const sourceTracks = (session.tracks ?? []).map<SourceTrack>(
    (track, index) => ({
      id: track.id,
      name: track.name,
      colorIndex: sessionSourceTrackColorIndex(track.colorIndex, index),
      recordingPaths: (track.recordings ?? []).map(
        (recording) => recording.filename,
      ),
    }),
  );
  const nameByTrack = new Map(
    sourceTracks.map((track) => [track.id, track.name]),
  );

  const sourceSpans = (session.clips ?? []).map<SourceSpan>((clip) => {
    const swatch = getSwatch(
      sourceTracks.find((track) => track.id === clip.trackId)?.colorIndex ?? 0,
    );
    const media = pickMediaByPath(mediaItems, clip.filePath);
    const trimStartSeconds = clipSourceFrame(clip) / fps;
    return {
      id: `source-${clip.id}`,
      sourceTrackId: clip.trackId,
      label:
        nameByTrack.get(clip.trackId) ?? clip.name ?? `Track ${clip.trackId}`,
      mediaPath: clip.filePath,
      mediaId: media?.id,
      startQ: secondsToQuarters(clip.frameStart / fps, bpm),
      durationSeconds: Math.max(1, clip.frameCount) / fps,
      trimStartSeconds,
      // `clipStart + frameOffset` is the content start in the warp markers'
      // seconds, before any capture offset. A start-trimmed span's warp
      // stays anchored where it was before the trim.
      warp: createClipWarp(
        clip.warpMarkers,
        ((clip.clipStart ?? 0) + (clip.frameOffset ?? 0)) / fps,
        readWarpAnchorSeconds(clip, trimStartSeconds),
        bpm,
      ),
      tint: swatch.color,
      accent: swatch.accent,
    };
  });

  const arrangementClips: ArrangementClip[] = [];
  // The clip the session was saved with selected, if it could be placed.
  let selectedClipId: string | undefined;

  for (const selection of session.selections ?? []) {
    const selectionStartQ = secondsToQuarters(selection.frameStart / fps, bpm);
    const selectionDurationQ = secondsToQuarters(
      Math.max(1, selection.frameEnd - selection.frameStart) / fps,
      bpm,
    );
    // A slipped selection names its span and offset; any other plays the
    // span it falls in, at that span's offset.
    const slip = readSelectionSlip(selection);
    const slipSpan = slip
      ? sourceSpans.find((span) => span.id === slip.sourceSpanId)
      : undefined;
    const sourceSpan =
      slipSpan ??
      chooseSourceSpanForWindow(
        sourceSpans,
        selection.trackId,
        selectionStartQ,
        selectionDurationQ,
        bpm,
      );
    if (!sourceSpan) {
      continue;
    }

    const sourceOffsetSeconds =
      slip && slipSpan
        ? slip.sourceOffsetSeconds
        : sourceSpan.trimStartSeconds -
          quartersToSeconds(sourceSpan.startQ, bpm);
    const startSeconds = selection.frameStart / fps;
    const durationSeconds =
      Math.max(1, selection.frameEnd - selection.frameStart) / fps;

    if (selection.selected && selectedClipId === undefined) {
      selectedClipId = `selection-${selection.id}`;
    }
    arrangementClips.push({
      id: `selection-${selection.id}`,
      sourceSpanId: sourceSpan.id,
      sourceTrackId: selection.trackId,
      laneId: selection.mainTrackId,
      label: nameByTrack.get(selection.trackId) ?? sourceSpan.label,
      mediaPath: sourceSpan.mediaPath,
      mediaId: sourceSpan.mediaId,
      startQ: selectionStartQ,
      durationSeconds,
      trimStartSeconds: startSeconds + sourceOffsetSeconds,
      sourceOffsetSeconds,
      sourceWindowStartSeconds: sourceSpan.trimStartSeconds,
      sourceWindowEndSeconds:
        sourceSpan.trimStartSeconds + sourceSpan.durationSeconds,
      warp: sourceSpan.warp,
      tint: sourceSpan.tint,
      accent: sourceSpan.accent,
    });
  }

  const unresolvedPaths = arrangementClips
    .filter((clip) => !clip.mediaId)
    .map((clip) => basename(clip.mediaPath));

  const layerClips = [
    ...readSessionFills(session, bpm, fps).map((clip) => ({
      clip,
      create: createFillClip,
    })),
    ...readSessionTexts(session, bpm, fps).map((clip) => ({
      clip,
      create: createTextClip,
    })),
    ...readSessionFxClips(session, bpm, fps).map((clip) => ({
      clip,
      create: createFxClip,
    })),
  ];
  for (const { clip, create } of layerClips) {
    const lane = lanes.find((candidate) => candidate.id === clip.laneId);
    if (!lane) {
      continue;
    }

    if (clip.selected && selectedClipId === undefined) {
      selectedClipId = clip.id;
    }
    arrangementClips.push(
      create({
        id: clip.id,
        laneId: clip.laneId,
        startQ: clip.startQ,
        durationQ: clip.durationQ,
        bpm,
        tint: FILL_CLIP_TINT,
        accent:
          lane.colorIndex >= 0
            ? getSwatch(lane.colorIndex).accent
            : FILL_CLIP_ACCENT,
      }),
    );
  }

  return {
    bpm,
    fps,
    canvasWidth: Math.max(
      MIN_CANVAS_DIMENSION,
      session.timeline?.canvasWidth ?? 1080,
    ),
    canvasHeight: Math.max(
      MIN_CANVAS_DIMENSION,
      session.timeline?.canvasHeight ?? 1920,
    ),
    ...(session.timeline?.encoding !== undefined
      ? { encoding: readSessionEncoding(session.timeline.encoding) }
      : {}),
    lanes,
    sourceTracks,
    sourceSpans,
    arrangementClips,
    selectedClipId,
    // Every layer gets its own Layout, taking over any global one, and an
    // older session gets its default Order and its layers' Text and Color
    // moved onto their text and fill clips, an old Colorize Reactivity
    // becomes Reactive animation, and an old Order Margin toggle becomes its
    // Margin knob, as part of the load so none of it is a
    // separate undo step. Stacks of clips, source tracks and source clips
    // that could not be loaded are dropped with them.
    effects: migrateClipContentEffects(
      pruneSourceEffects(
        pruneClipEffects(
          migrateDefaultOrder(
            ensureLayerLayouts(
              migrateOrderOuterMargin(
                migrateColorizeReactivity(mapEffects(session.effects)),
              ),
              (lanes.length ? lanes : DEFAULT_LANES).map((lane) => lane.id),
            ),
            session.orderDefaulted,
          ),
          arrangementClips,
        ),
        sourceTracks,
        sourceSpans,
      ),
      arrangementClips,
      session.clipContentEffects,
    ),
    displaySeconds: session.timeline?.displaySeconds ?? false,
    snapToBeat: session.timeline?.snapToBeat ?? true,
    zoom: clamp(session.timeline?.zoom ?? 1, ZOOM_MIN, ZOOM_MAX),
    projectDurationFrames: session.timeline?.projectDuration,
    playPositionFrames: session.playPosition ?? 0,
    playStartPositionFrames: session.playStartPosition ?? 0,
    sourceTracksLocked: session.sourceTracksLocked === true,
    mainAudioMediaId: session.audioFilename
      ? pickMediaByPath(mediaItems, session.audioFilename)?.id
      : undefined,
    unresolvedPaths,
    overlapNote: formatOverlapNote(overlaps),
  };
}

export function buildStandaloneProject(mediaItems: MediaItem[]) {
  const lanes = DEFAULT_LANES;
  const canvasWidth = mediaItems.find((item) => item.width)?.width ?? 1080;
  const canvasHeight = mediaItems.find((item) => item.height)?.height ?? 1920;
  const fps = mediaFrameRate(mediaItems);
  const sourceTracks = mediaItems.map<SourceTrack>((item, index) => ({
    id: `import-track-${index}`,
    name: item.name.replace(/\.[^/.]+$/, ""),
    colorIndex: sourceTrackColorIndex(index),
    recordingPaths: [item.name],
  }));
  const sourceSpans = mediaItems.map<SourceSpan>((item, index) => {
    const swatch = getSwatch(sourceTrackColorIndex(index));
    return {
      id: `source-span-${item.id}`,
      sourceTrackId: sourceTracks[index]?.id ?? `import-track-${index}`,
      label: item.name.replace(/\.[^/.]+$/, ""),
      mediaPath: item.name,
      mediaId: item.id,
      startQ: 0,
      durationSeconds: Math.max(1, item.durationSeconds),
      trimStartSeconds: 0,
      tint: swatch.color,
      accent: swatch.accent,
    };
  });
  const arrangementClips = mediaItems.map<ArrangementClip>((item, index) => {
    const sourceSpan = sourceSpans[index];
    return {
      id: `import-clip-${item.id}`,
      sourceSpanId: sourceSpan?.id ?? `source-span-${item.id}`,
      sourceTrackId:
        sourceSpan?.sourceTrackId ??
        sourceTracks[index]?.id ??
        `import-track-${index}`,
      laneId: lanes[index % lanes.length]?.id ?? lanes[0].id,
      label: item.name.replace(/\.[^/.]+$/, ""),
      mediaPath: item.name,
      mediaId: item.id,
      startQ: index * 4,
      durationSeconds: Math.max(1, item.durationSeconds),
      trimStartSeconds: index * quartersToSeconds(4, 120),
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: Math.max(0, item.durationSeconds),
      tint: sourceSpan?.tint ?? getSwatch(index).color,
      accent: sourceSpan?.accent ?? getSwatch(index).accent,
    };
  });
  return {
    lanes,
    sourceTracks,
    sourceSpans,
    arrangementClips,
    canvasWidth,
    canvasHeight,
    fps,
  };
}

/**
 * The frame rate of the first video among `mediaItems`, snapped to a standard
 * rate, for a session created from them. Undefined when none has one.
 */
export function mediaFrameRate(mediaItems: readonly MediaItem[]) {
  const fps = mediaItems.find(
    (item) => item.hasVideo && item.fps && Number.isFinite(item.fps),
  )?.fps;
  return fps && fps > 0 ? snapFrameRate(fps) : undefined;
}
