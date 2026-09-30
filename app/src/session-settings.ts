// Session Settings: a session's canvas size, frame rate and the encoding its
// export uses, with their defaults, presets and validation.
//
// Canvas size and frame rate live on the project as they always have; the
// encoding is kept beside them as `encoding`, which older projects and
// sessions lack and read as the defaults.

import type { ProjectState } from "./app/types.ts";

export type VideoCodecChoice = "auto" | "h264" | "hevc" | "av1";
export type EncodableVideoCodec = Exclude<VideoCodecChoice, "auto">;
export type VideoQuality = "low" | "medium" | "high" | "custom";
export type AudioBitrateKbps = 128 | 192 | 256 | 320;
export type AudioSampleRate = 44100 | 48000;

export type SessionEncoding = {
  videoCodec: VideoCodecChoice;
  quality: VideoQuality;
  // Used when `quality` is "custom"; the presets derive theirs.
  customBitrateMbps?: number;
  audioBitrateKbps: AudioBitrateKbps;
  audioSampleRate: AudioSampleRate;
};

export type SessionSettings = {
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  encoding: SessionEncoding;
};

export const DEFAULT_SESSION_ENCODING: SessionEncoding = {
  videoCodec: "auto",
  quality: "high",
  audioBitrateKbps: 192,
  audioSampleRate: 48000,
};

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  canvasWidth: 1920,
  canvasHeight: 1080,
  fps: 30,
  encoding: DEFAULT_SESSION_ENCODING,
};

export const MIN_CANVAS_DIMENSION = 16;
export const MAX_CANVAS_DIMENSION = 7680;

export type CanvasPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { id: "1080p", label: "1080p 16:9", width: 1920, height: 1080 },
  { id: "1080x1920", label: "1080×1920 9:16", width: 1080, height: 1920 },
  { id: "1080x1080", label: "1080×1080 1:1", width: 1080, height: 1080 },
  { id: "4k", label: "4K 16:9", width: 3840, height: 2160 },
  { id: "720p", label: "720p 16:9", width: 1280, height: 720 },
];

export const CUSTOM_PRESET_ID = "custom";

export const FRAME_RATES: readonly { label: string; value: number }[] = [
  { label: "23.976", value: 24000 / 1001 },
  { label: "24", value: 24 },
  { label: "25", value: 25 },
  { label: "29.97", value: 30000 / 1001 },
  { label: "30", value: 30 },
  { label: "50", value: 50 },
  { label: "59.94", value: 60000 / 1001 },
  { label: "60", value: 60 },
];

export const VIDEO_CODECS: readonly {
  value: VideoCodecChoice;
  label: string;
}[] = [
  { value: "auto", label: "Auto (best available)" },
  { value: "h264", label: "H.264" },
  { value: "hevc", label: "HEVC" },
  { value: "av1", label: "AV1" },
];

// Auto picks the first of these the device can encode.
export const AUTO_CODEC_ORDER: readonly EncodableVideoCodec[] = [
  "hevc",
  "av1",
  "h264",
];

export const VIDEO_QUALITIES: readonly { value: VideoQuality; label: string }[] =
  [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "custom", label: "Custom" },
  ];

export const AUDIO_BITRATES: readonly AudioBitrateKbps[] = [128, 192, 256, 320];
export const AUDIO_SAMPLE_RATES: readonly AudioSampleRate[] = [44100, 48000];

export const UNSUPPORTED_CODEC_REASON = "Not supported on this device";

// 1080p30 at High is 12 Mbps; bitrate grows a little slower than the pixel
// count and the frame rate, so 4K30 High comes to about 45 Mbps.
const REFERENCE_BITRATE_MBPS = 12;
const REFERENCE_PIXELS = 1920 * 1080;
const REFERENCE_FPS = 30;
const QUALITY_FACTORS: Record<Exclude<VideoQuality, "custom">, number> = {
  low: 0.35,
  medium: 0.6,
  high: 1,
};

/** The bitrate, in Mbps, a preset quality gives this size and frame rate. */
export function presetBitrateMbps(
  width: number,
  height: number,
  fps: number,
  quality: Exclude<VideoQuality, "custom">,
) {
  const pixels = Math.max(1, width * height) / REFERENCE_PIXELS;
  const rate = Math.max(1, fps) / REFERENCE_FPS;
  const mbps =
    REFERENCE_BITRATE_MBPS *
    QUALITY_FACTORS[quality] *
    pixels ** 0.95 *
    rate ** 0.75;
  return Math.max(0.5, Math.round(mbps * 2) / 2);
}

/** The video bitrate, in Mbps, the settings export at. */
export function videoBitrateMbps(settings: SessionSettings) {
  const { encoding } = settings;
  if (encoding.quality === "custom") {
    return (
      encoding.customBitrateMbps ??
      presetBitrateMbps(
        settings.canvasWidth,
        settings.canvasHeight,
        settings.fps,
        "high",
      )
    );
  }
  return presetBitrateMbps(
    settings.canvasWidth,
    settings.canvasHeight,
    settings.fps,
    encoding.quality,
  );
}

/** The preset whose size is `width` × `height`, or "custom". */
export function matchCanvasPreset(width: number, height: number) {
  return (
    CANVAS_PRESETS.find(
      (preset) => preset.width === width && preset.height === height,
    )?.id ?? CUSTOM_PRESET_ID
  );
}

/** The settings with the preset's size, or unchanged for an unknown id. */
export function applyCanvasPreset(
  settings: SessionSettings,
  presetId: string,
): SessionSettings {
  const preset = CANVAS_PRESETS.find((candidate) => candidate.id === presetId);
  return preset
    ? { ...settings, canvasWidth: preset.width, canvasHeight: preset.height }
    : settings;
}

/** The label of the listed frame rate `fps` is, or undefined for another. */
export function matchFrameRate(fps: number) {
  return FRAME_RATES.find((rate) => Math.abs(rate.value - fps) < 1e-6)?.label;
}

/** `fps` as the dropdown lists it, e.g. "29.97", or to three decimals. */
export function formatFrameRate(fps: number) {
  return matchFrameRate(fps) ?? String(Math.round(fps * 1000) / 1000);
}

function roundToEven(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * The settings with one canvas dimension set to `value`. With the aspect
 * locked the other follows at the current aspect, rounded to an even size.
 */
export function resizeCanvas(
  settings: SessionSettings,
  dimension: "width" | "height",
  value: number,
  lockAspect: boolean,
): SessionSettings {
  const { canvasWidth, canvasHeight } = settings;
  if (dimension === "width") {
    return {
      ...settings,
      canvasWidth: value,
      canvasHeight:
        lockAspect && canvasWidth > 0 && Number.isFinite(value) && value > 0
          ? roundToEven((value * canvasHeight) / canvasWidth)
          : canvasHeight,
    };
  }
  return {
    ...settings,
    canvasHeight: value,
    canvasWidth:
      lockAspect && canvasHeight > 0 && Number.isFinite(value) && value > 0
        ? roundToEven((value * canvasWidth) / canvasHeight)
        : canvasWidth,
  };
}

/** The settings with width and height swapped. */
export function swapCanvasOrientation(
  settings: SessionSettings,
): SessionSettings {
  return {
    ...settings,
    canvasWidth: settings.canvasHeight,
    canvasHeight: settings.canvasWidth,
  };
}

// Which codecs the device can encode; a codec that is missing has not been
// checked yet.
export type VideoCodecSupport = Partial<Record<EncodableVideoCodec, boolean>>;

/** The codec Auto exports with, or undefined when none is known to work. */
export function resolveAutoCodec(support: VideoCodecSupport) {
  return AUTO_CODEC_ORDER.find((codec) => support[codec]);
}

/** The codec choices, with those the device can't encode disabled. */
export function videoCodecOptions(support: VideoCodecSupport) {
  return VIDEO_CODECS.map(({ value, label }) => {
    const disabled = value !== "auto" && support[value] === false;
    return {
      value,
      label,
      disabled,
      ...(disabled ? { reason: UNSUPPORTED_CODEC_REASON } : {}),
    };
  });
}

export type SessionSettingsErrors = Partial<
  Record<"canvasWidth" | "canvasHeight" | "fps" | "bitrate" | "codec", string>
>;

function dimensionError(value: number) {
  if (!Number.isInteger(value)) {
    return "Enter a whole number of pixels.";
  }
  if (value < MIN_CANVAS_DIMENSION || value > MAX_CANVAS_DIMENSION) {
    return `Must be ${MIN_CANVAS_DIMENSION}–${MAX_CANVAS_DIMENSION} px.`;
  }
  if (value % 2 !== 0) {
    return "Must be even for video encoders.";
  }
  return undefined;
}

/** The problems with the settings, by field; empty when they are valid. */
export function validateSessionSettings(
  settings: SessionSettings,
  support: VideoCodecSupport = {},
): SessionSettingsErrors {
  const errors: SessionSettingsErrors = {};
  const widthError = dimensionError(settings.canvasWidth);
  if (widthError) {
    errors.canvasWidth = widthError;
  }
  const heightError = dimensionError(settings.canvasHeight);
  if (heightError) {
    errors.canvasHeight = heightError;
  }
  if (!Number.isFinite(settings.fps) || settings.fps <= 0) {
    errors.fps = "Frame rate must be greater than 0.";
  }
  const { encoding } = settings;
  if (
    encoding.quality === "custom" &&
    !(
      Number.isFinite(encoding.customBitrateMbps) &&
      (encoding.customBitrateMbps ?? 0) > 0
    )
  ) {
    errors.bitrate = "Bitrate must be greater than 0 Mbps.";
  }
  if (encoding.videoCodec !== "auto" && support[encoding.videoCodec] === false) {
    errors.codec = UNSUPPORTED_CODEC_REASON;
  }
  return errors;
}

export function hasSessionSettingsErrors(errors: SessionSettingsErrors) {
  return Object.values(errors).some(Boolean);
}

function isOneOf<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

/**
 * The encoding a session or project was saved with, with anything missing
 * or malformed read as its default. Session files are unchecked JSON.
 */
export function readSessionEncoding(value: unknown): SessionEncoding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_SESSION_ENCODING;
  }
  const saved = value as Record<string, unknown>;
  const codecs = VIDEO_CODECS.map((codec) => codec.value);
  const qualities = VIDEO_QUALITIES.map((quality) => quality.value);
  const custom = saved.customBitrateMbps;
  return {
    videoCodec: isOneOf(codecs, saved.videoCodec)
      ? saved.videoCodec
      : DEFAULT_SESSION_ENCODING.videoCodec,
    quality: isOneOf(qualities, saved.quality)
      ? saved.quality
      : DEFAULT_SESSION_ENCODING.quality,
    ...(typeof custom === "number" && Number.isFinite(custom) && custom > 0
      ? { customBitrateMbps: custom }
      : {}),
    audioBitrateKbps: isOneOf(AUDIO_BITRATES, saved.audioBitrateKbps)
      ? saved.audioBitrateKbps
      : DEFAULT_SESSION_ENCODING.audioBitrateKbps,
    audioSampleRate: isOneOf(AUDIO_SAMPLE_RATES, saved.audioSampleRate)
      ? saved.audioSampleRate
      : DEFAULT_SESSION_ENCODING.audioSampleRate,
  };
}

type SettingsFields = Pick<
  ProjectState,
  "canvasWidth" | "canvasHeight" | "fps" | "encoding"
>;

/** The project's session settings. */
export function sessionSettingsFromProject(
  project: SettingsFields,
): SessionSettings {
  return {
    canvasWidth: project.canvasWidth,
    canvasHeight: project.canvasHeight,
    fps: project.fps,
    encoding: readSessionEncoding(project.encoding),
  };
}

function sameEncoding(a: SessionEncoding, b: SessionEncoding) {
  return (
    a.videoCodec === b.videoCodec &&
    a.quality === b.quality &&
    a.customBitrateMbps === b.customBitrateMbps &&
    a.audioBitrateKbps === b.audioBitrateKbps &&
    a.audioSampleRate === b.audioSampleRate
  );
}

/**
 * The project with the settings applied, or the same project when nothing
 * changes. Clips are placed in beats and seconds, so a new frame rate moves
 * none of them; the session length, kept in frames, is rescaled to it.
 */
export function applySessionSettings(
  project: ProjectState,
  settings: SessionSettings,
): ProjectState {
  const current = readSessionEncoding(project.encoding);
  const patch: Partial<ProjectState> = {
    canvasWidth: settings.canvasWidth,
    canvasHeight: settings.canvasHeight,
    fps: settings.fps,
  };
  // Unchanged defaults stay unset, so applying nothing is no edit.
  if (!sameEncoding(current, settings.encoding)) {
    patch.encoding = settings.encoding;
  }
  if (
    project.projectDurationFrames !== undefined &&
    settings.fps !== project.fps &&
    project.fps > 0
  ) {
    patch.projectDurationFrames = Math.round(
      (project.projectDurationFrames * settings.fps) / project.fps,
    );
  }
  const changed = (Object.keys(patch) as Array<keyof typeof patch>).some(
    (key) => !Object.is(project[key], patch[key]),
  );
  return changed ? { ...project, ...patch } : project;
}
