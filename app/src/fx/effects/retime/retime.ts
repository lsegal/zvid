// The Retime effect: on a clip's own stack, it plays the clip's video, GIF
// or Lottie at another speed, from -5× (backwards) through 0× (frozen) to
// 5×. It scales the media time the clip is drawn at, after warp, around the
// clip's start, so the clip's first frame stays put and the rest of it
// plays faster, slower or backwards from there, looping through the media.
// Only the picture is retimed: the clip's sound keeps its own timing.
//
// Blend crossfades from each source frame into the next by how far the
// retimed time has got through it, so slow and fast speeds move smoothly
// rather than stepping. Optical flow interpolation is out of scope: it needs
// a motion-estimation pass over pairs of frames that is far too costly to
// run per clip per frame in the preview's WebGL 1 pipeline.

export const RETIME_EFFECT_NAME = "Retime";
export const SPEED_KEY = "Speed";
export const INTERPOLATION_KEY = "Interpolation";

export const MIN_SPEED = -5;
export const MAX_SPEED = 5;
export const SPEED_STEP = 0.1;
export const DEFAULT_SPEED = 1;

export const RETIME_INTERPOLATIONS = ["None", "Blend"] as const;
export type RetimeInterpolation = (typeof RETIME_INTERPOLATIONS)[number];
export const DEFAULT_INTERPOLATION: RetimeInterpolation = "None";

export type RetimeSettings = {
  speed: number;
  interpolation: RetimeInterpolation;
};

type RetimeParameter = { key: string; value: string; numericValue?: number };

type RetimeEffect = {
  trackId: string;
  effectName: string;
  enabled?: boolean;
  parameters: readonly RetimeParameter[];
};

// `value` on the 0.1 grid and within range; NaN reads as the default.
export function snapSpeed(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SPEED;
  }
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
  // Rounded twice so 0.30000000000000004 reads as 0.3 and -0 as 0.
  return (
    Math.round(Math.round(clamped / SPEED_STEP) * SPEED_STEP * 10) / 10 || 0
  );
}

export function parseRetimeSettings(
  parameters: readonly RetimeParameter[],
): RetimeSettings {
  const speed = parameters.find((parameter) => parameter.key === SPEED_KEY);
  const interpolation = parameters
    .find((parameter) => parameter.key === INTERPOLATION_KEY)
    ?.value.toLowerCase();
  return {
    speed: snapSpeed(
      speed?.numericValue ?? Number.parseFloat(speed?.value ?? ""),
    ),
    interpolation:
      RETIME_INTERPOLATIONS.find(
        (option) => option.toLowerCase() === interpolation,
      ) ?? DEFAULT_INTERPOLATION,
  };
}

// What the enabled Retimes on the `trackId` stack retime a clip by, or
// undefined when they leave it as it is. Several multiply their speeds, and
// the last one's interpolation applies.
export function resolveRetime(
  effects: readonly RetimeEffect[],
  trackId: string,
): RetimeSettings | undefined {
  let retime: RetimeSettings | undefined;
  for (const effect of effects) {
    if (
      effect.trackId !== trackId ||
      effect.enabled === false ||
      effect.effectName !== RETIME_EFFECT_NAME
    ) {
      continue;
    }
    const next = parseRetimeSettings(effect.parameters);
    retime = {
      speed: (retime?.speed ?? 1) * next.speed,
      interpolation: next.interpolation,
    };
  }
  return retime && (retime.speed !== 1 || retime.interpolation !== "None")
    ? retime
    : undefined;
}

// The media time a clip retimed to `speed` is drawn at, given the time it
// would be drawn at and the time its start is drawn at.
export function retimeSeconds(
  seconds: number,
  anchorSeconds: number,
  speed: number,
) {
  return anchorSeconds + (seconds - anchorSeconds) * speed;
}

// `seconds` looped into the media's `[0, durationSeconds)`, before its start
// as past its end, as a clip playing backwards needs.
export function wrapMediaTime(seconds: number, durationSeconds: number) {
  if (!(durationSeconds > 0)) {
    return Math.max(0, seconds);
  }
  const wrapped = seconds % durationSeconds;
  return wrapped < 0 ? wrapped + durationSeconds : wrapped;
}

// A source frame, from `start` to `end` seconds into its media.
export type FrameSpan = { start: number; end: number };

// The source frame a time falls in and the one after it.
export type FrameSpans = { current: FrameSpan; next: FrameSpan };

// Blend's two frames at `seconds`: the middle of the frame it falls in and
// of the next, and how far (0..1) `seconds` has got from the first toward
// the second.
export function blendFrames(seconds: number, { current, next }: FrameSpans) {
  const length = current.end - current.start;
  const weight =
    length > 0
      ? Math.min(1, Math.max(0, (seconds - current.start) / length))
      : 0;
  return {
    from: (current.start + current.end) / 2,
    to: (next.start + next.end) / 2,
    weight,
  };
}

// The frames of a video around `seconds`, counting frames of
// `1 / frameRate` from its start.
export function gridFrameSpans(seconds: number, frameRate: number): FrameSpans {
  const length = 1 / frameRate;
  const start = Math.floor(seconds * frameRate + 1e-6) * length;
  return {
    current: { start, end: start + length },
    next: { start: start + length, end: start + 2 * length },
  };
}
