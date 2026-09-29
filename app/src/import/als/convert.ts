// Converts a parsed Ableton Live set into an `LvpSession`, the session shape
// the Layers app saved as `.lvp`. Arrangement clips are unrolled into one LVP
// clip per played segment and placed on the video frame grid. Clips on a track
// with a Layers Record or ZVID Capture device play one of its recordings (see
// `TAKE_MATCHERS`), and audio clips whose sample is a video file play that
// file as imported video. Both are video clips. A set with video keeps only
// the tracks that have a video clip, as the Layers app did. In a set without
// any, every audio and MIDI track is kept: audio clips play their sample, and
// MIDI clips are media-less placeholders that video can be linked to.
//
// Everything is derived from the `.als` alone. `mainTracks` and `selections`
// are Layers-app data with no counterpart in Live, so the import opens with an
// empty arrangement, as the Layers app did: one empty `Layer 1` and no
// selections. The user builds the edit from the source clips. Effects are out
// of scope. Media probing (`numFrames`, `frameRate`) and resolving recording
// files on disk happen elsewhere.

import type { LvpSession } from "../../session.ts";
import type {
  AlsClip,
  AlsDocument,
  AlsTrack,
  CaptureDeviceKind,
  LayersRecording,
  RecordRoot,
  ZvidCaptureState,
  ZvidCaptureTake,
} from "./parse.ts";
import {
  beatsToFrames,
  createTempoMap,
  createWarpMap,
  secondsToFrames,
  type TempoMap,
  type UnrolledClip,
  unrollClipLoop,
  type WarpMap,
} from "./time.ts";

type LvpClip = NonNullable<LvpSession["clips"]>[number];

export type AlsSkipReason =
  /** The clip is deactivated in Live. */
  | "disabled"
  /** The track has a capture device but no recordings. */
  | "no-recording"
  /** No ZVID Capture take overlaps the clip. */
  | "no-take"
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
  /** Where each ZVID Capture recording was saved, by filename. */
  recordRoots?: Record<string, RecordRoot>;
  /**
   * Ids of tracks whose recordings come from Layers Record. Their audio
   * clips' `captureOffset` is end-aligned once the recording is probed (see
   * `probeAlsRecordings`).
   */
  layersRecordTracks?: string[];
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
  const recordings = videoTracks.flatMap(trackRecordings);
  const recordRoots: Record<string, RecordRoot> = {};
  for (const track of videoTracks) {
    const zvid = zvidState(track);
    if (!zvid) continue;
    for (const take of zvid.recordings.filter(isAnchored)) {
      recordRoots[take.filename] = take.recordRoot ?? zvid.recordRoot;
    }
  }
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
  const allClips: LvpClip[] = [];
  const videoClips: LvpClip[] = [];
  const importedVideos = new Map<AlsTrack, Set<string>>();
  for (const track of importedTracks) {
    const trackTakes = track.isVideoTrack ? trackRecordings(track) : [];
    const matchTake = TAKE_MATCHERS[captureDevice(track)];
    for (const clip of track.clips) {
      const content = clipContent(clip, tempoMap);
      const recording = trackTakes.length
        ? matchTake(trackTakes, clip, content, tempoMap)
        : undefined;
      const importedVideo = !track.isVideoTrack && isVideoSample(clip);
      const skip = (reason: AlsSkipReason, clipId = lvpClipId(track, clip)) =>
        skipped.push({
          trackId: String(track.id),
          trackName: track.name,
          clipId,
          clipName: clip.name,
          reason,
        });
      if (clip.disabled) skip("disabled");
      else if (track.isVideoTrack && !trackTakes.length) skip("no-recording");
      else if (track.isVideoTrack && !recording) skip("no-take");
      else {
        for (const converted of convertClip(
          track,
          clip,
          content,
          recording,
          importedVideo,
          tempoMap,
          fps,
        )) {
          if (converted.frameCount < 1) {
            skip("shorter-than-frame", converted.id);
          } else {
            allClips.push(converted);
            if (recording || importedVideo) videoClips.push(converted);
            if (importedVideo) {
              const files = importedVideos.get(track) ?? new Set();
              importedVideos.set(track, files.add(converted.filePath));
            }
          }
        }
      }
    }
  }

  // In a set with video, the source tracks are the tracks that play it.
  const videoTrackIds = new Set(videoClips.map((clip) => clip.trackId));
  const isSourceTrack = (trackId: string) =>
    !videoClips.length || videoTrackIds.has(trackId);
  const sourceTracks = importedTracks.filter((track) =>
    isSourceTrack(String(track.id)),
  );
  const clips = allClips.filter((clip) => isSourceTrack(clip.trackId));
  // Skips on a dropped track without video would only be noise.
  const reported = new Set(
    importedTracks
      .filter((track) => track.isVideoTrack || isSourceTrack(String(track.id)))
      .map((track) => String(track.id)),
  );
  const reportedSkips = skipped.filter((entry) => reported.has(entry.trackId));

  const { transport } = doc;
  const projectDuration =
    transport.loopOn && transport.loopLength > 0
      ? beatsToFrames(transport.loopStart + transport.loopLength, tempoMap, fps)
      : Math.max(0, ...clips.map((clip) => clip.frameStart + clip.frameCount));
  const playPosition = Number.isFinite(transport.currentTime)
    ? beatsToFrames(transport.currentTime, tempoMap, fps)
    : 0;

  const session: LvpSession = {
    mainTracks: [{ id: "1", name: "Layer 1", colorIndex: -1 }],
    tracks: sourceTracks.map((track) => ({
      id: String(track.id),
      name: track.name,
      recordings: [
        ...trackRecordings(track).map(({ filename, frameStart }) => ({
          filename,
          frameStart,
        })),
        ...Array.from(importedVideos.get(track) ?? [], (filename) => ({
          filename,
        })),
      ],
    })),
    clips,
    selections: [],
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
  const layersRecordTracks = videoTracks
    .filter((track) => captureDevice(track) === "layers-record")
    .map((track) => String(track.id));
  return {
    session,
    summary: {
      skipped: reportedSkips,
      hasLayersVideo: videoClips.length > 0,
      ...(Object.keys(recordRoots).length > 0 && { recordRoots }),
      ...(layersRecordTracks.length > 0 && { layersRecordTracks }),
    },
  };
}

type TakeMatcher = (
  recordings: readonly LayersRecording[],
  clip: AlsClip,
  content: ClipContent,
  tempoMap: TempoMap,
) => LayersRecording | undefined;

/** How each capture device picks the recording an arranged clip plays. */
const TAKE_MATCHERS: Record<CaptureDeviceKind, TakeMatcher> = {
  // Layers Record kept one recording per track that mattered: the last.
  "layers-record": (recordings) => recordings.at(-1),
  // An audio clip plays the take its content was recorded in, wherever the
  // clip was moved, trimmed or copied to since. Where takes overlap, the one
  // its sample was recorded with wins, so clips sharing a sample share a
  // take. A MIDI clip has no recorded content, so it plays the take under it.
  "zvid-capture": (recordings, clip, content, tempoMap) =>
    matchZvidTake(
      recordings as readonly ZvidCaptureTake[],
      ...(content.recordedSpan ?? [
        tempoMap.beatsToSeconds(clip.currentStart),
        tempoMap.beatsToSeconds(clip.currentEnd),
      ]),
      content.sampleSpan ?? undefined,
    ),
};

function captureDevice(track: AlsTrack): CaptureDeviceKind {
  return track.captureDevice ?? "layers-record";
}

function zvidState(track: AlsTrack): ZvidCaptureState | null {
  return captureDevice(track) === "zvid-capture"
    ? (track.layers as ZvidCaptureState | null)
    : null;
}

function isAnchored(take: ZvidCaptureTake) {
  return (
    take.transportStartSec !== null && Number.isFinite(take.transportStartSec)
  );
}

/**
 * The recordings a track can place on the timeline, one source-track entry
 * each. Unanchored ZVID Capture takes have no song position, so they are left
 * out.
 */
function trackRecordings(track: AlsTrack): LayersRecording[] {
  const zvid = zvidState(track);
  return zvid
    ? zvid.recordings.filter(isAnchored)
    : (track.layers?.recordings ?? []);
}

/**
 * The anchored take whose `[transportStartSec, transportStartSec +
 * durationSec)` span overlaps the song-time span `[startSec, endSec)` the
 * most, preferring the latest `createdAt` on a tie. `undefined` when no
 * take overlaps it.
 *
 * With `sampleSpan`, the song-time span a clip's whole sample was recorded
 * over, the overlapping take that best fits the sample wins instead: the one
 * sharing the most of the sample's span with it, less the time only one of
 * the two covers. Several takes can start at the same song time, and this
 * picks the one whose length matches the sample's.
 */
export function matchZvidTake<T extends ZvidCaptureTake>(
  takes: readonly T[],
  startSec: number,
  endSec: number,
  sampleSpan?: readonly [number, number],
): T | undefined {
  const spanOf = (take: T) => {
    const takeStart = take.transportStartSec as number;
    return [takeStart, takeStart + Math.max(0, take.durationSec || 0)];
  };
  const overlap = (take: T, start: number, end: number) => {
    const [takeStart, takeEnd] = spanOf(take);
    return Math.min(end, takeEnd) - Math.max(start, takeStart);
  };
  const score = (take: T) => {
    if (!sampleSpan) return overlap(take, startSec, endSec);
    const [sampleStart, sampleEnd] = sampleSpan;
    const [takeStart, takeEnd] = spanOf(take);
    const shared = overlap(take, sampleStart, sampleEnd);
    const union =
      Math.max(sampleEnd, takeEnd) - Math.min(sampleStart, takeStart);
    return shared - (union - Math.max(0, shared));
  };

  let best: { take: T; score: number; createdAt: number } | undefined;
  for (const take of takes) {
    if (!isAnchored(take) || !(overlap(take, startSec, endSec) > 0)) continue;
    const createdAt = Date.parse(take.createdAt);
    const candidate = {
      take,
      score: score(take),
      createdAt: Number.isNaN(createdAt) ? -Infinity : createdAt,
    };
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.createdAt > best.createdAt)
    ) {
      best = candidate;
    }
  }
  return best?.take;
}

const VIDEO_EXTENSIONS = /\.(?:mp4|mov|m4v)$/i;

function samplePath(clip: AlsClip) {
  return clip.sample?.path || clip.sample?.relativePath || "";
}

/** True for an audio clip whose sample is a video file imported into Live. */
function isVideoSample(clip: AlsClip) {
  return clip.kind === "audio" && VIDEO_EXTENSIONS.test(samplePath(clip));
}

function lvpClipId(track: AlsTrack, clip: AlsClip) {
  return `${track.id}-${clip.id}`;
}

/**
 * One LVP clip per unrolled segment of `clip`, including segments shorter
 * than a frame, which the caller drops.
 *
 * Every clip follows the Layers convention: its video file frame is
 * `clipStart + frameOffset + captureOffset`. `clipStart` is the content start
 * in frames, which for audio goes through the clip's warp map to sample
 * seconds and for MIDI converts beats to seconds, and `captureOffset` is the
 * file frame at the content origin. For a Layers recording that is the
 * recording's `frameStart`, the file frame where its audio starts.
 *
 * The audio content start is warp-aware on purpose: Layers itself ignored
 * warp markers, but Live plays the warped sample time, which is the one that
 * lines up with the recording.
 *
 * A ZVID Capture take started independently of the sample, so audio content
 * maps to the song time it was recorded at and from there into the take (see
 * `clipContent`), and MIDI content maps its arrangement position onto the
 * take. Its `captureOffset` is whatever puts `clipStart` at that file frame.
 *
 * Without a Layers `recording`, an audio clip plays its own sample and a MIDI
 * clip becomes a placeholder with no media, both with a `captureOffset` of 0.
 * An `importedVideo` clip is written as the Layers app wrote one, with
 * `clipStart: 0` and the `captureOffset: -1` sentinel: its warp markers, not
 * a capture offset, place the video.
 */
function convertClip(
  track: AlsTrack,
  clip: AlsClip,
  content: ClipContent,
  recording: LayersRecording | undefined,
  importedVideo: boolean,
  tempoMap: TempoMap,
  fps: number,
): LvpClip[] {
  const isAudio = clip.kind === "audio";
  const { unrolled, warpMap, recordedAt } = content;
  const take =
    recording && captureDevice(track) === "zvid-capture"
      ? (recording as ZvidCaptureTake)
      : undefined;
  const contentToFrames = (position: number) =>
    warpMap
      ? secondsToFrames(warpMap.beatToSampleSec(position), fps)
      : beatsToFrames(position, tempoMap, fps);
  // The file frame a ZVID Capture segment starts at: where its audio content
  // was recorded, or where it sits in the song.
  const takeFrame = (take: ZvidCaptureTake, songSeconds: number) =>
    Math.max(
      0,
      secondsToFrames(
        take.fileOffsetSec + songSeconds - (take.transportStartSec as number),
        fps,
      ),
    );
  const duration = clip.sample
    ? clip.sample.defaultDuration / clip.sample.defaultSampleRate
    : Number.NaN;
  const baseId = lvpClipId(track, clip);
  const filePath = recording?.filename ?? (isAudio ? samplePath(clip) : "");

  return unrolled.segments.map((segment, index) => {
    const id = index === 0 ? baseId : `${baseId}~${index}`;
    const startSeconds = tempoMap.beatsToSeconds(segment.arrStartBeat);
    const endSeconds = tempoMap.beatsToSeconds(segment.arrEndBeat);
    const clipStart = importedVideo
      ? 0
      : contentToFrames(segment.contentStartBeat);
    const captureOffset = importedVideo
      ? -1
      : take
        ? takeFrame(
            take,
            recordedAt ? recordedAt(segment.contentStartBeat) : startSeconds,
          ) - clipStart
        : (recording?.frameStart ?? 0);
    return {
      id,
      trackId: String(track.id),
      name: clip.name,
      frameStart: secondsToFrames(startSeconds, fps),
      frameCount: secondsToFrames(endSeconds - startSeconds, fps),
      frameOffset: 0,
      clipStart,
      filePath,
      // Live keeps an unwarped clip's markers but plays it at native speed,
      // so it gets none here: the player follows every clip's markers.
      warpMarkers: (isAudio && !clip.isWarped ? [] : clip.warpMarkers).map(
        (marker, markerIndex) => ({
          id: String(markerIndex),
          clipId: id,
          secTime: marker.secTime,
          beatTime: marker.beatTime,
        }),
      ),
      frameHiddenLoopEnd: contentToFrames(unrolled.hiddenLoopEnd),
      captureOffset,
      audioFileDuration: Number.isFinite(duration) ? duration : "NaN",
    };
  });
}

type ClipContent = {
  unrolled: UnrolledClip;
  warpMap: WarpMap | null;
  /**
   * Song seconds at which an audio clip's content position was recorded, or
   * `null` for a MIDI clip.
   */
  recordedAt: ((position: number) => number) | null;
  /** Song-time span over which the content the clip plays was recorded. */
  recordedSpan: [number, number] | null;
  /** Song-time span over which the clip's whole sample was recorded. */
  sampleSpan: [number, number] | null;
};

/**
 * How `clip`'s content lines up with the arrangement and with the song time
 * it was recorded at.
 *
 * Live warps an arrangement recording so its content beats are the song
 * beats it was recorded over, which a trimmed, moved or copied clip keeps.
 * Sample second 0 was therefore recorded at the song time of the beat its
 * warp map puts there, and every later sample second follows in real time.
 * An unwarped clip keeps no beat grid, so it is taken to play its content at
 * the song time it was recorded.
 */
function clipContent(clip: AlsClip, tempoMap: TempoMap): ClipContent {
  const isAudio = clip.kind === "audio";
  const isWarped = !isAudio || clip.isWarped;
  const unrolled = unrollClipLoop(
    {
      ...clip.loop,
      currentStart: clip.currentStart,
      currentEnd: clip.currentEnd,
    },
    { isWarped, tempoMap },
  );
  const warpMap = isAudio ? tryWarpMap(clip) : null;
  const [first] = unrolled.segments;
  if (!isAudio || !first || (isWarped && !warpMap)) {
    return {
      unrolled,
      warpMap,
      recordedAt: null,
      recordedSpan: null,
      sampleSpan: null,
    };
  }

  // Song seconds at which sample second 0 was recorded.
  let origin: number;
  let recordedAt: (position: number) => number;
  if (warpMap && isWarped) {
    origin = tempoMap.beatsToSeconds(warpMap.sampleSecToBeat(0));
    recordedAt = (position) => origin + warpMap.beatToSampleSec(position);
  } else {
    origin =
      tempoMap.beatsToSeconds(first.arrStartBeat) - first.contentStartBeat;
    recordedAt = (position) => origin + position;
  }
  const sampleDuration = clip.sample
    ? clip.sample.defaultDuration / clip.sample.defaultSampleRate
    : Number.NaN;
  // Warped content advances one beat per arrangement beat, unwarped content
  // one second per arrangement second.
  const contentEnd = (segment: (typeof unrolled.segments)[number]) =>
    segment.contentStartBeat +
    (isWarped
      ? segment.arrEndBeat - segment.arrStartBeat
      : tempoMap.beatsToSeconds(segment.arrEndBeat) -
        tempoMap.beatsToSeconds(segment.arrStartBeat));
  const starts = unrolled.segments.map((segment) =>
    recordedAt(segment.contentStartBeat),
  );
  const ends = unrolled.segments.map((segment) =>
    recordedAt(contentEnd(segment)),
  );
  return {
    unrolled,
    warpMap,
    recordedAt,
    recordedSpan: [Math.min(...starts), Math.max(...ends)],
    sampleSpan:
      Number.isFinite(sampleDuration) && sampleDuration > 0
        ? [origin, origin + sampleDuration]
        : null,
  };
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
