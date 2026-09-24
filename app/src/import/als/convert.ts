// Converts a parsed Ableton Live set into an `LvpSession`, the session shape
// the Layers app saved as `.lvp`. Every audio and MIDI track becomes an LVP
// track, and its arrangement clips are unrolled into one LVP clip per played
// segment and placed on the video frame grid. Clips on a track with a Layers
// Record device play its recording; other audio clips play their sample, and
// other MIDI clips are media-less placeholders that video can be linked to.
//
// Everything is derived from the `.als` alone. `mainTracks` and `selections`
// are Layers-app data with no counterpart in Live, so a minimal default is
// generated; effects are out of scope. Media probing (`numFrames`,
// `frameRate`) and resolving recording files on disk happen elsewhere.

import type { LvpSession } from "../../session.ts";
import type {
  AlsClip,
  AlsDocument,
  AlsTrack,
  LayersRecording,
} from "./parse.ts";
import {
  beatsToFrames,
  createTempoMap,
  createWarpMap,
  secondsToFrames,
  type TempoMap,
  unrollClipLoop,
} from "./time.ts";

type LvpClip = NonNullable<LvpSession["clips"]>[number];

export type AlsSkipReason =
  /** The clip is deactivated in Live. */
  | "disabled"
  /** The track has a Layers Record device but no recordings. */
  | "no-recording"
  /** The clip, or one unrolled segment of it, rounds to zero frames. */
  | "shorter-than-frame";

export interface AlsSkippedClip {
  trackId: string;
  trackName: string;
  /** LVP clip id, including a `~n` suffix for an unrolled loop segment. */
  clipId: string;
  clipName: string;
  reason: AlsSkipReason;
}

export interface AlsImportSummary {
  skipped: AlsSkippedClip[];
  /** True when at least one imported clip plays a Layers recording. */
  hasLayersVideo: boolean;
}

export interface AlsImportOptions {
  /** Path of the `.als` file, stored as `sessionFile`. */
  sessionFile?: string;
  /** Mixdown audio for the session, usually `siblingAudioFilename(...)`. */
  audioFilename?: string;
}

export interface AlsImportResult {
  session: LvpSession;
  summary: AlsImportSummary;
}

const DEFAULT_FPS = 30;
const DEFAULT_MAIN_TRACK = { id: "1", name: "Layer 1" };

/**
 * The `<name>.wav` mixdown next to a `.als` file. The caller checks whether it
 * exists before passing it as `audioFilename`.
 */
export function siblingAudioFilename(alsPath: string) {
  return /\.als$/i.test(alsPath)
    ? alsPath.replace(/\.als$/i, ".wav")
    : `${alsPath}.wav`;
}

export function convertAls(
  doc: AlsDocument,
  options: AlsImportOptions = {},
): AlsImportResult {
  const tempoMap = createTempoMap(
    doc.tempoAutomation.map((point) => ({ beat: point.time, bpm: point.bpm })),
    doc.tempo,
  );
  const videoTracks = doc.tracks.filter((track) => track.isVideoTrack);
  const importedTracks = doc.tracks.filter(
    (track) =>
      track.isVideoTrack || track.kind === "audio" || track.kind === "midi",
  );
  const recordings = videoTracks.flatMap(
    (track) => track.layers?.recordings ?? [],
  );
  const fpsFraction = mostCommon(
    recordings
      .map((recording) => recording.fps)
      .filter(([numerator, denominator]) => numerator > 0 && denominator > 0),
  );
  const fps = fpsFraction ? fpsFraction[0] / fpsFraction[1] : DEFAULT_FPS;
  const dimensions = mostCommon(
    recordings
      .map((recording) => recording.dimensions)
      .filter(([width, height]) => width > 0 && height > 0),
  );

  const skipped: AlsSkippedClip[] = [];
  const clips: LvpClip[] = [];
  const videoClips: LvpClip[] = [];
  for (const track of importedTracks) {
    const recording = track.isVideoTrack
      ? track.layers?.recordings.at(-1)
      : undefined;
    for (const clip of track.clips) {
      const skip = (reason: AlsSkipReason, clipId = lvpClipId(track, clip)) =>
        skipped.push({
          trackId: String(track.id),
          trackName: track.name,
          clipId,
          clipName: clip.name,
          reason,
        });
      if (clip.disabled) skip("disabled");
      else if (track.isVideoTrack && !recording) skip("no-recording");
      else {
        for (const converted of convertClip(
          track,
          clip,
          recording,
          tempoMap,
          fps,
        )) {
          if (converted.frameCount < 1) {
            skip("shorter-than-frame", converted.id);
          } else {
            clips.push(converted);
            if (recording) videoClips.push(converted);
          }
        }
      }
    }
  }

  const { transport } = doc;
  const projectDuration =
    transport.loopOn && transport.loopLength > 0
      ? beatsToFrames(transport.loopStart + transport.loopLength, tempoMap, fps)
      : Math.max(0, ...clips.map((clip) => clip.frameStart + clip.frameCount));
  const playPosition = Number.isFinite(transport.currentTime)
    ? beatsToFrames(transport.currentTime, tempoMap, fps)
    : 0;

  // Layers video is what the arrangement shows. A set without any gets its
  // other clips there instead, so its structure is visible.
  const arrangedClips = videoClips.length ? videoClips : clips;

  const session: LvpSession = {
    mainTracks: [{ ...DEFAULT_MAIN_TRACK }],
    tracks: importedTracks.map((track) => ({
      id: String(track.id),
      name: track.name,
      recordings: (track.layers?.recordings ?? []).map(
        ({ filename, frameStart }) => ({ filename, frameStart }),
      ),
    })),
    clips,
    selections: arrangedClips.map((clip, index) => ({
      id: index + 1,
      trackId: clip.trackId,
      mainTrackId: DEFAULT_MAIN_TRACK.id,
      frameStart: clip.frameStart,
      frameEnd: clip.frameStart + clip.frameCount,
      selected: false,
    })),
    timeline: {
      bpm: doc.tempo,
      fps,
      ...(dimensions && {
        canvasWidth: dimensions[0],
        canvasHeight: dimensions[1],
      }),
      projectDuration,
    },
    playPosition,
    playStartPosition: playPosition,
    ...(options.audioFilename !== undefined && {
      audioFilename: options.audioFilename,
    }),
    ...(options.sessionFile !== undefined && {
      sessionFile: options.sessionFile,
    }),
  };
  return {
    session,
    summary: { skipped, hasLayersVideo: videoClips.length > 0 },
  };
}

function lvpClipId(track: AlsTrack, clip: AlsClip) {
  return `${track.id}-${clip.id}`;
}

/**
 * One LVP clip per unrolled segment of `clip`, including segments shorter
 * than a frame, which the caller drops.
 *
 * Audio content positions go through the clip's warp map to sample seconds,
 * which is also the recording's timeline. MIDI clips have no sample timeline,
 * so their arrangement position maps straight onto the recording instead.
 *
 * Without a Layers `recording`, an audio clip plays its own sample and a MIDI
 * clip becomes a placeholder with no media, positioned as if a recording
 * started at the top of the arrangement.
 */
function convertClip(
  track: AlsTrack,
  clip: AlsClip,
  recording: LayersRecording | undefined,
  tempoMap: TempoMap,
  fps: number,
): LvpClip[] {
  const isAudio = clip.kind === "audio";
  const unrolled = unrollClipLoop(
    {
      ...clip.loop,
      currentStart: clip.currentStart,
      currentEnd: clip.currentEnd,
    },
    { isWarped: !isAudio || clip.isWarped, tempoMap },
  );
  const warpMap = isAudio ? tryWarpMap(clip) : null;
  const contentToFrames = (position: number) =>
    warpMap
      ? secondsToFrames(warpMap.beatToSampleSec(position), fps)
      : beatsToFrames(position, tempoMap, fps);
  const duration = clip.sample
    ? clip.sample.defaultDuration / clip.sample.defaultSampleRate
    : Number.NaN;
  const baseId = lvpClipId(track, clip);
  const captureOffset = recording?.frameStart ?? 0;
  const filePath =
    recording?.filename ??
    (isAudio ? clip.sample?.path || clip.sample?.relativePath || "" : "");

  return unrolled.segments.map((segment, index) => {
    const id = index === 0 ? baseId : `${baseId}~${index}`;
    const startSeconds = tempoMap.beatsToSeconds(segment.arrStartBeat);
    const endSeconds = tempoMap.beatsToSeconds(segment.arrEndBeat);
    const frameStart = secondsToFrames(startSeconds, fps);
    return {
      id,
      trackId: String(track.id),
      name: clip.name,
      frameStart,
      frameCount: secondsToFrames(endSeconds - startSeconds, fps),
      frameOffset: 0,
      clipStart: isAudio
        ? contentToFrames(segment.contentStartBeat)
        : Math.max(0, frameStart - captureOffset),
      filePath,
      warpMarkers: clip.warpMarkers.map((marker, markerIndex) => ({
        id: String(markerIndex),
        clipId: id,
        secTime: marker.secTime,
        beatTime: marker.beatTime,
      })),
      frameHiddenLoopEnd: contentToFrames(unrolled.hiddenLoopEnd),
      captureOffset,
      audioFileDuration: Number.isFinite(duration) ? duration : "NaN",
    };
  });
}

/** The clip's warp map, or `null` when a warped clip lacks usable markers. */
function tryWarpMap(clip: AlsClip) {
  try {
    return createWarpMap(clip.warpMarkers, clip.isWarped);
  } catch {
    return null;
  }
}

/** Most frequent `[a, b]` pair, preferring the earliest on a tie. */
function mostCommon(
  pairs: ReadonlyArray<[number, number]>,
): [number, number] | undefined {
  const counts = new Map<string, { pair: [number, number]; count: number }>();
  for (const pair of pairs) {
    const key = pair.join("/");
    const entry = counts.get(key) ?? { pair, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  let best: { pair: [number, number]; count: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.pair;
}
