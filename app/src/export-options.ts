// The Export dialog's options: the session's Session Settings, overridable
// for one export without changing the session, plus the In→Out range to
// render and the file name to save as.

import { quartersToSeconds, secondsToQuarters } from "./app/timeline-math.ts";
import { sanitizeFilenameSegment } from "./app/util.ts";
import {
  hasSessionSettingsErrors,
  type SessionSettings,
  type SessionSettingsErrors,
  type VideoCodecSupport,
  validateSessionSettings,
  videoBitrateMbps,
} from "./session-settings.ts";

export type ExportRange = {
  // The range to render, in quarter notes on the session timeline.
  inQ: number;
  outQ: number;
};

export type ExportOptions = SessionSettings &
  ExportRange & {
    fileName: string;
  };

// The settings an export can override, each shown with a "modified" dot
// when it differs from Session Settings.
export type ExportSettingField =
  | "resolution"
  | "fps"
  | "videoCodec"
  | "quality"
  | "audioBitrateKbps"
  | "audioSampleRate";

export type ExportOptionsErrors = SessionSettingsErrors &
  Partial<Record<"range" | "fileName", string>>;

type RangeClip = { startQ: number; durationSeconds: number };

export type DefaultRangeInputs = {
  clips: readonly RangeClip[];
  bpm: number;
  fps: number;
  // The session length from the opened session, in frames at `fps`.
  projectDurationFrames?: number;
};

const MP4_EXTENSION = ".mp4";

function clipEndQ(clip: RangeClip, bpm: number) {
  return clip.startQ + secondsToQuarters(clip.durationSeconds, bpm);
}

/**
 * The range an export starts with: from the first clip's start to the
 * session length when the session has one, else to the last clip's end.
 */
export function defaultExportRange({
  clips,
  bpm,
  fps,
  projectDurationFrames,
}: DefaultRangeInputs): ExportRange {
  if (!clips.length) {
    return { inQ: 0, outQ: 0 };
  }
  const inQ = Math.max(0, Math.min(...clips.map((clip) => clip.startQ)));
  const lastClipEndQ = Math.max(...clips.map((clip) => clipEndQ(clip, bpm)));
  const projectEndQ =
    projectDurationFrames && projectDurationFrames > 0 && fps > 0
      ? secondsToQuarters(projectDurationFrames / fps, bpm)
      : 0;
  return { inQ, outQ: projectEndQ > inQ ? projectEndQ : lastClipEndQ };
}

/** "My Session" → "My Session.mp4", with characters files can't use replaced. */
export function normalizeExportFileName(fileName: string) {
  const trimmed = fileName.trim();
  const base = trimmed.toLowerCase().endsWith(MP4_EXTENSION)
    ? trimmed.slice(0, -MP4_EXTENSION.length)
    : trimmed;
  return `${sanitizeFilenameSegment(base)}${MP4_EXTENSION}`;
}

export function defaultExportFileName(sessionName: string | null) {
  return normalizeExportFileName(sessionName ?? "zvid-session");
}

export function createExportOptions(
  session: SessionSettings,
  range: ExportRange,
  fileName: string,
): ExportOptions {
  return {
    ...session,
    encoding: { ...session.encoding },
    inQ: range.inQ,
    outQ: range.outQ,
    fileName,
  };
}

/** The options' settings, without the range and file name. */
export function exportSettings(options: ExportOptions): SessionSettings {
  return {
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    fps: options.fps,
    encoding: options.encoding,
  };
}

function fieldValues(settings: SessionSettings) {
  const { encoding } = settings;
  return {
    resolution: `${settings.canvasWidth}x${settings.canvasHeight}`,
    fps: settings.fps,
    videoCodec: encoding.videoCodec,
    quality:
      encoding.quality === "custom"
        ? `custom:${encoding.customBitrateMbps}`
        : encoding.quality,
    audioBitrateKbps: encoding.audioBitrateKbps,
    audioSampleRate: encoding.audioSampleRate,
  } satisfies Record<ExportSettingField, unknown>;
}

/** The settings the options override, in form order. */
export function modifiedExportFields(
  options: ExportOptions,
  session: SessionSettings,
): ExportSettingField[] {
  const current = fieldValues(options);
  const saved = fieldValues(session);
  return (Object.keys(current) as ExportSettingField[]).filter(
    (field) => current[field] !== saved[field],
  );
}

/** The options with every setting back at Session Settings. */
export function resetExportSettings(
  options: ExportOptions,
  session: SessionSettings,
): ExportOptions {
  return createExportOptions(
    session,
    { inQ: options.inQ, outQ: options.outQ },
    options.fileName,
  );
}

/**
 * The options last used, reopened against the current Session Settings:
 * overridden settings stay overridden, and the rest follow any change made
 * to the session since.
 */
export function reopenExportOptions(
  remembered: ExportOptions,
  rememberedSession: SessionSettings,
  session: SessionSettings,
): ExportOptions {
  const modified = new Set(modifiedExportFields(remembered, rememberedSession));
  const pick = <T>(field: ExportSettingField, own: T, fromSession: T) =>
    modified.has(field) ? own : fromSession;
  const { encoding } = remembered;
  const quality = pick("quality", encoding, session.encoding);
  return {
    ...remembered,
    canvasWidth: pick(
      "resolution",
      remembered.canvasWidth,
      session.canvasWidth,
    ),
    canvasHeight: pick(
      "resolution",
      remembered.canvasHeight,
      session.canvasHeight,
    ),
    fps: pick("fps", remembered.fps, session.fps),
    encoding: {
      videoCodec: pick(
        "videoCodec",
        encoding.videoCodec,
        session.encoding.videoCodec,
      ),
      quality: quality.quality,
      ...(quality.customBitrateMbps !== undefined
        ? { customBitrateMbps: quality.customBitrateMbps }
        : {}),
      audioBitrateKbps: pick(
        "audioBitrateKbps",
        encoding.audioBitrateKbps,
        session.encoding.audioBitrateKbps,
      ),
      audioSampleRate: pick(
        "audioSampleRate",
        encoding.audioSampleRate,
        session.encoding.audioSampleRate,
      ),
    },
  };
}

/** The length of one frame at `fps`, in quarter notes. */
export function frameQuarters(fps: number, bpm: number) {
  return secondsToQuarters(1 / Math.max(1, fps), bpm);
}

/** `q` on the nearest frame at `fps`. */
export function snapToFrame(q: number, fps: number, bpm: number) {
  const frameRate = Math.max(1, fps);
  const frames = Math.round(quartersToSeconds(q, bpm) * frameRate);
  return secondsToQuarters(frames / frameRate, bpm);
}

/**
 * Where a marker dragged to `q` lands: on the nearest beat, or, with
 * `free` (Shift held), on the nearest frame. Never before the start.
 */
export function snapExportQ(
  q: number,
  {
    beatQ,
    free,
    fps,
    bpm,
  }: {
    beatQ: number;
    free: boolean;
    fps: number;
    bpm: number;
  },
) {
  const snapped =
    free || beatQ <= 0
      ? snapToFrame(q, fps, bpm)
      : Math.round(q / beatQ) * beatQ;
  return Math.max(0, snapped);
}

/**
 * The range with one marker moved to `q`, kept at least one frame from the
 * other marker so the range never inverts or empties.
 */
export function moveExportMarker(
  range: ExportRange,
  marker: "in" | "out",
  q: number,
  minimumQ: number,
): ExportRange {
  if (marker === "in") {
    return { ...range, inQ: Math.max(0, Math.min(q, range.outQ - minimumQ)) };
  }
  return { ...range, outQ: Math.max(q, range.inQ + minimumQ) };
}

export type ExportTiming = {
  startSeconds: number;
  durationSeconds: number;
  frameCount: number;
};

/** Where the export starts, how long it runs, and how many frames it renders. */
export function exportTiming(
  options: ExportOptions,
  bpm: number,
): ExportTiming {
  const fps = Math.max(1, options.fps);
  const startSeconds = quartersToSeconds(Math.max(0, options.inQ), bpm);
  const endSeconds = quartersToSeconds(Math.max(0, options.outQ), bpm);
  const frameCount = Math.max(1, Math.round((endSeconds - startSeconds) * fps));
  return { startSeconds, durationSeconds: frameCount / fps, frameCount };
}

/** The file size the options should come to, in bytes. */
export function estimateExportBytes(
  options: ExportOptions,
  durationSeconds: number,
  hasAudio: boolean,
) {
  const videoBitsPerSecond = videoBitrateMbps(options) * 1_000_000;
  const audioBitsPerSecond = hasAudio
    ? options.encoding.audioBitrateKbps * 1000
    : 0;
  return Math.round(
    ((videoBitsPerSecond + audioBitsPerSecond) * Math.max(0, durationSeconds)) /
      8,
  );
}

/** `12_345_678` → "12.3 MB". */
export function formatFileSize(bytes: number) {
  if (bytes < 1_000_000) {
    return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  }
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/**
 * Seconds from a typed timecode: `mm:ss:ff`, `hh:mm:ss:ff`, `ss:ff`, or plain
 * seconds like `3.5`. Undefined when it isn't one.
 */
export function parseTimecode(text: string, fps: number) {
  const trimmed = text.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (!/^\d+(:\d+){1,3}$/.test(trimmed)) {
    return undefined;
  }
  const parts = trimmed.split(":").map(Number);
  const frames = parts.pop() ?? 0;
  const frameRate = Math.max(1, fps);
  if (frames >= Math.ceil(frameRate)) {
    return undefined;
  }
  const [seconds = 0, minutes = 0, hours = 0] = parts.reverse();
  if (parts.length > 1 && seconds >= 60) {
    return undefined;
  }
  return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
}

/** A length in quarter notes as `bars.beats.sixteenths`, all counted from 0. */
export function formatMusicalLength(
  quarters: number,
  signature: { numerator: number; denominator: number },
) {
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  // Lengths a hair under a whole beat, from float error, read as the beat.
  const safe = Math.max(0, quarters) + 1e-9;
  const bars = Math.floor(safe / barLength);
  const beats = Math.floor((safe - bars * barLength) / beatUnit);
  const sixteenths = Math.floor(
    (safe - bars * barLength - beats * beatUnit) / (beatUnit / 4),
  );
  return `${bars}.${beats}.${sixteenths}`;
}

/** The problems with the options, by field; empty when they can export. */
export function validateExportOptions(
  options: ExportOptions,
  bpm: number,
  support: VideoCodecSupport = {},
): ExportOptionsErrors {
  const errors: ExportOptionsErrors = validateSessionSettings(options, support);
  if (
    !Number.isFinite(options.inQ) ||
    !Number.isFinite(options.outQ) ||
    options.outQ - options.inQ < frameQuarters(options.fps, bpm) - 1e-9
  ) {
    errors.range = "Out must be at least one frame after In.";
  }
  if (!options.fileName.trim()) {
    errors.fileName = "Enter a file name.";
  }
  return errors;
}

export function hasExportOptionsErrors(errors: ExportOptionsErrors) {
  return hasSessionSettingsErrors(errors);
}
