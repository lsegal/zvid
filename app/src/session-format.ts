import type { LvpSession } from "./session.ts";

// A session's canvas size and frame rate, detected from the video it is
// created from. Imports and opens use it to match the session to its media,
// before the session reaches the editor, so it is not an undo step.

/** What a probe reads from one video file's primary video track. */
export type VideoFormatProbe = {
  /** Frame width before rotation, in square pixels. */
  width?: number;
  /** Frame height before rotation, in square pixels. */
  height?: number;
  /** Clockwise rotation from the file's metadata, in degrees. */
  rotation?: number;
  frameRate?: number;
};

export type DetectedSessionFormat = {
  width?: number;
  height?: number;
  fps?: number;
  /** Lines for the import summary, such as a note on mixed sizes. */
  notes: string[];
};

// Standard rates a measured rate snaps to. NTSC rates are exact fractions so
// a snapped rate matches the one a Live set stores as `[30000, 1001]`.
const STANDARD_FRAME_RATES = [
  24000 / 1001,
  24,
  25,
  30000 / 1001,
  30,
  50,
  60000 / 1001,
  60,
];

// A container's average packet rate drifts a little from its nominal rate.
const FRAME_RATE_TOLERANCE = 0.005;

const isNear = (fps: number, rate: number) =>
  Math.abs(fps - rate) / rate <= FRAME_RATE_TOLERANCE;

/**
 * The nearest standard rate within half a percent of `fps`, or `fps` rounded
 * to three decimals when none is that close.
 */
export function snapFrameRate(fps: number) {
  const [nearest] = STANDARD_FRAME_RATES.filter((rate) =>
    isNear(fps, rate),
  ).sort((a, b) => Math.abs(fps - a) - Math.abs(fps - b));
  return nearest ?? Math.round(fps * 1000) / 1000;
}

/** The size a frame is shown at once its rotation is applied. */
export function displayedSize(probe: VideoFormatProbe) {
  const { width, height } = probe;
  if (!width || !height || width <= 0 || height <= 0) {
    return null;
  }

  const quarterTurns = Math.round((probe.rotation ?? 0) / 90);
  return quarterTurns % 2 === 0
    ? { width, height }
    : { width: height, height: width };
}

/** Most frequent value, preferring the earliest on a tie, with its counts. */
function tally<T>(values: T[], key: (value: T) => string) {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const entry = counts.get(key(value)) ?? { value, count: 0 };
    entry.count++;
    counts.set(key(value), entry);
  }
  let best: { value: T; count: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return { best: best?.value, counts: Array.from(counts.values()) };
}

function formatSize(size: { width: number; height: number }) {
  return `${size.width}×${size.height}`;
}

function describeSizeCounts(
  counts: Array<{ value: { width: number; height: number }; count: number }>,
) {
  // "3 recordings were 1920×1080, 1 was 1280×720"
  return [...counts]
    .sort((a, b) => b.count - a.count)
    .map(({ value, count }, index) => {
      const noun = index > 0 ? "" : count === 1 ? " recording" : " recordings";
      const verb = count === 1 ? "was" : "were";
      return `${count}${noun} ${verb} ${formatSize(value)}`;
    })
    .join(", ");
}

/**
 * The canvas size and frame rate the probed videos agree on most: the most
 * common displayed size, so portrait phone video gives a portrait canvas, and
 * the most common frame rate, snapped to a standard rate. A field no probe
 * could provide is left out, for the caller to fall back on.
 */
export function detectSessionFormat(
  probes: readonly VideoFormatProbe[],
): DetectedSessionFormat {
  const sizes = probes
    .map(displayedSize)
    .filter((size): size is { width: number; height: number } => !!size);
  const rates = probes
    .map((probe) => probe.frameRate)
    .filter((rate): rate is number => !!rate && Number.isFinite(rate))
    .filter((rate) => rate > 0)
    .map((rate) => snapFrameRate(rate));
  const size = tally(sizes, formatSize);
  const rate = tally(rates, String);
  const notes =
    size.best && size.counts.length > 1
      ? [
          `${describeSizeCounts(size.counts)}; canvas set to ${formatSize(size.best)}.`,
        ]
      : [];
  return {
    ...size.best,
    ...(rate.best !== undefined && { fps: rate.best }),
    notes,
  };
}

// Frame positions a session stores, which all count frames at its rate.
function rescaleFrames(session: LvpSession, ratio: number): LvpSession {
  const scale = (frames: number) => Math.round(frames * ratio);
  const scaleOptional = (frames: number | undefined) =>
    frames === undefined ? undefined : scale(frames);
  const scaleLayerClip = <T extends { frameStart: number; frameEnd: number }>(
    clip: T,
  ) => ({
    ...clip,
    frameStart: scale(clip.frameStart),
    frameEnd: scale(clip.frameEnd),
  });
  const withDefined = <T extends object>(value: T) =>
    Object.fromEntries(
      Object.entries(value).filter(([, field]) => field !== undefined),
    ) as T;

  return withDefined({
    ...session,
    tracks: session.tracks?.map((track) => ({
      ...track,
      recordings: track.recordings?.map((recording) =>
        withDefined({
          ...recording,
          frameStart: scaleOptional(recording.frameStart),
        }),
      ),
    })),
    clips: session.clips?.map((clip) => {
      // Scaling the end keeps back-to-back clips back to back.
      const frameStart = scale(clip.frameStart);
      const frameEnd = scale(clip.frameStart + clip.frameCount);
      return withDefined({
        ...clip,
        frameStart,
        frameCount: frameEnd - frameStart,
        frameOffset: scaleOptional(clip.frameOffset),
        clipStart: scaleOptional(clip.clipStart),
        frameHiddenLoopEnd: scaleOptional(clip.frameHiddenLoopEnd),
        // Imported videos mark `captureOffset` as -1.
        captureOffset:
          clip.captureOffset === -1 ? -1 : scaleOptional(clip.captureOffset),
      });
    }),
    selections: session.selections?.map(scaleLayerClip),
    fills: session.fills?.map(scaleLayerClip),
    texts: session.texts?.map(scaleLayerClip),
    fxClips: session.fxClips?.map(scaleLayerClip),
    timeline: session.timeline && {
      ...session.timeline,
      ...(session.timeline.projectDuration !== undefined && {
        projectDuration: scale(session.timeline.projectDuration),
      }),
    },
    playPosition: scaleOptional(session.playPosition),
    playStartPosition: scaleOptional(session.playStartPosition),
  });
}

/**
 * The session with its canvas and frame rate taken from `detected`, keeping
 * its own for any field that was not detected. Its frame positions are
 * rescaled to the new rate so everything keeps its time.
 */
export function applySessionFormat(
  session: LvpSession,
  detected: Omit<DetectedSessionFormat, "notes">,
): LvpSession {
  const fps = session.timeline?.fps;
  const rescaled =
    detected.fps && fps && Math.abs(detected.fps - fps) > 1e-9
      ? rescaleFrames(session, detected.fps / fps)
      : session;
  return {
    ...rescaled,
    timeline: {
      ...rescaled.timeline,
      ...(detected.fps && { fps: detected.fps }),
      ...(detected.width &&
        detected.height && {
          canvasWidth: detected.width,
          canvasHeight: detected.height,
        }),
    },
  };
}

/**
 * The session with only the canvas and frame rate it lacks taken from
 * `detected`. A saved canvas or rate is an authored setting and is kept.
 * Frame positions are left alone: without a saved rate they were never tied
 * to one.
 */
export function fillMissingSessionFormat(
  session: LvpSession,
  detected: Omit<DetectedSessionFormat, "notes">,
): LvpSession {
  const timeline = session.timeline ?? {};
  const hasCanvas = !!timeline.canvasWidth && !!timeline.canvasHeight;
  const fps = timeline.fps || detected.fps;
  const width = hasCanvas ? timeline.canvasWidth : detected.width;
  const height = hasCanvas ? timeline.canvasHeight : detected.height;
  return {
    ...session,
    timeline: {
      ...timeline,
      ...(fps && { fps }),
      ...(width && height && { canvasWidth: width, canvasHeight: height }),
    },
  };
}

/** Whether an opened session lacks a canvas size or frame rate of its own. */
export function lacksSessionFormat(session: LvpSession) {
  const timeline = session.timeline;
  return !timeline?.fps || !timeline.canvasWidth || !timeline.canvasHeight;
}

type ProbeRef = { path: string; url: string; exists: boolean };

/**
 * Probes every located file in `refs`, by path. A file that cannot be probed
 * is left out: an unreadable file still opens, it just goes undetected.
 */
export async function probeRefs<T>(
  refs: readonly ProbeRef[],
  probe: (url: string) => Promise<T | null>,
) {
  const probes = new Map<string, T>();
  await Promise.all(
    refs.map(async (ref) => {
      if (!ref.exists || !ref.url) {
        return;
      }

      try {
        const result = await probe(ref.url);
        if (result) {
          probes.set(ref.path, result);
        }
      } catch {
        // Left undetected.
      }
    }),
  );
  return probes;
}

/**
 * An opened `.lvp` session with the canvas size and frame rate it lacks
 * detected from its media. A session with both saved is returned unchanged
 * and nothing is probed.
 */
export async function detectOpenedSessionFormat(
  session: LvpSession,
  mediaRefs: readonly ProbeRef[],
  probe: (url: string) => Promise<VideoFormatProbe | null>,
) {
  if (!lacksSessionFormat(session)) {
    return session;
  }

  const probes = await probeRefs(mediaRefs, probe);
  return fillMissingSessionFormat(
    session,
    detectSessionFormat(Array.from(probes.values())),
  );
}
