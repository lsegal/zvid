// Where an FX device's knobs are while its Animation or Modulation moves
// them, for the FX panel to show alongside where they are set. Each mode
// is worked out as the compositor or the audio chain works it out, so a
// knob points at what is drawn or heard: Animation's Clip, Reactive and LFO
// modes, and Modulation's Transient and LFO.

import type { AudioStageModulation } from "./audio-mix/modulation.ts";
import { lfoSwing, modulatedValue } from "./audio-mix/modulation.ts";
import { DEFAULT_TIME_SIGNATURE } from "./audio-mix/processor.ts";
import { audioStageOf } from "./audio-mix/stages.ts";
import type { AnimatedParameter } from "./fx-animation.ts";
import { reactsToAudio } from "./fx-animation.ts";
import { resolveClipAnimatedParameters } from "./fx-animation-clip.ts";
import {
  DEFAULT_REACTIVE_RANGE_SCALE,
  type ReactiveOnset,
  reactiveOffset,
} from "./fx-animation-impulse.ts";
import { resolveLfoParameters } from "./fx-animation-lfo.ts";
import { resolveReactiveParameters } from "./fx-animation-reactive.ts";
import type { AnimationClipSpan } from "./fx-animation-trace.ts";
import type { FxDevice, FxDeviceParameter } from "./fx-stack.ts";
import type { MeterSignature } from "./timeline-format.ts";

export type LiveDevice = Pick<
  FxDevice,
  | "id"
  | "effectName"
  | "enabled"
  | "supportsAnimation"
  | "animation"
  | "supportsModulation"
  | "modulation"
> & {
  parameters: readonly Pick<
    FxDeviceParameter,
    "key" | "kind" | "numericValue" | "stringValue" | "defaultValue"
  >[];
};

// What moves a device's knobs: one of Animation's modes, or one of
// Modulation's.
export type LiveDriver =
  | { kind: "clip" }
  | { kind: "reactive"; keys: ReadonlySet<string> }
  | { kind: "lfo"; keys: ReadonlySet<string> }
  | { kind: "modulation"; modulation: AudioStageModulation };

// Where the session is: its playhead in seconds and its tempo and frame
// rate, and what the moving modes follow there. `clipSpan` is the clip
// Clip mode animates over, `onsets` the hits Reactive has heard, and
// `transient` the level and hit Modulation's Transient last reported.
export type LiveTime = {
  time: number;
  bpm: number;
  signature?: MeterSignature;
  fps: number;
  clipSpan?: AnimationClipSpan;
  onsets?: readonly ReactiveOnset[];
  transient?: { level: number; hit: number };
};

// The parameters as the compositor and audio chain read them.
function storedParameters(device: LiveDevice): AnimatedParameter[] {
  return device.parameters.map((parameter) => {
    const numericValue =
      parameter.numericValue ??
      (typeof parameter.defaultValue === "number"
        ? parameter.defaultValue
        : undefined);
    return {
      key: parameter.key,
      value:
        numericValue === undefined
          ? (parameter.stringValue ?? String(parameter.defaultValue))
          : String(numericValue),
      ...(numericValue === undefined ? {} : { numericValue }),
    };
  });
}

// What moves `device`'s knobs, or undefined when nothing does: it is off,
// or its modifier is off or would move nothing.
export function liveDriver(device: LiveDevice): LiveDriver | undefined {
  if (!device.enabled) {
    return undefined;
  }
  const animation = device.animation;
  if (device.supportsAnimation && animation?.enabled) {
    if (animation.mode === "clip") {
      return { kind: "clip" };
    }
    if (animation.mode === "lfo" && animation.lfo) {
      return animation.lfo.depth !== 0 && animation.lfo.parameters.length
        ? { kind: "lfo", keys: new Set(animation.lfo.parameters) }
        : undefined;
    }
    if (animation.reactive && reactsToAudio(device)) {
      return animation.reactive.parameters.length
        ? { kind: "reactive", keys: new Set(animation.reactive.parameters) }
        : undefined;
    }
    return undefined;
  }
  if (device.supportsModulation && device.modulation?.enabled) {
    const modulation = audioStageOf(
      {
        id: device.id,
        trackId: "",
        effectName: device.effectName,
        parameters: storedParameters(device),
        modulation: device.modulation,
      },
      device.id,
    ).modulation;
    return modulation ? { kind: "modulation", modulation } : undefined;
  }
  return undefined;
}

// Whether `driver` can move the knob `key`. Clip mode can move any knob.
export function drivesKnob(driver: LiveDriver | undefined, key: string) {
  if (!driver) {
    return false;
  }
  switch (driver.kind) {
    case "clip":
      return true;
    case "modulation":
      return driver.modulation.parameters.some(
        (parameter) => parameter.key === key,
      );
    default:
      return driver.keys.has(key);
  }
}

// Where the knob `key` of `device` is at `at` under `driver`, or undefined
// while it is where it is set: between hits, outside the clip Clip mode
// animates, or while the knob isn't moved at all.
export function liveKnobValue(
  device: LiveDevice,
  driver: LiveDriver | undefined,
  key: string,
  at: LiveTime,
): number | undefined {
  if (!driver || !drivesKnob(driver, key)) {
    return undefined;
  }
  const parameters = storedParameters(device);
  const stored = parameters.find((parameter) => parameter.key === key);
  const base = stored?.numericValue;
  if (base === undefined) {
    return undefined;
  }

  let value: number | undefined;
  if (driver.kind === "modulation") {
    const { modulation } = driver;
    const parameter = modulation.parameters.find((knob) => knob.key === key);
    if (!parameter) {
      return undefined;
    }
    const swing =
      modulation.mode === "lfo"
        ? lfoSwing(modulation, device.id, key, at.time, {
            bpm: at.bpm,
            signature: at.signature ?? DEFAULT_TIME_SIGNATURE,
          })
        : at.transient
          ? reactiveOffset(device.id, key, at.transient.hit) *
            at.transient.level *
            DEFAULT_REACTIVE_RANGE_SCALE
          : 0;
    value = modulatedValue(base, swing, parameter);
  } else {
    const effect = {
      id: device.id,
      effectName: device.effectName,
      parameters,
      animation: device.animation,
    };
    let resolved: AnimatedParameter[] = parameters;
    if (driver.kind === "clip") {
      const span = at.clipSpan;
      const elapsedSeconds = span ? at.time - span.startSeconds : -1;
      if (
        span &&
        elapsedSeconds >= 0 &&
        elapsedSeconds < span.durationSeconds
      ) {
        resolved = resolveClipAnimatedParameters(
          effect,
          {
            clipId: "",
            laneId: "",
            progress: elapsedSeconds / span.durationSeconds,
            elapsedSeconds,
            durationSeconds: span.durationSeconds,
            sessionEdges: span.sessionEdges,
          },
          { playheadQ: 0, bpm: at.bpm, fps: at.fps },
        );
      }
    } else if (driver.kind === "lfo" && device.animation?.lfo) {
      resolved = resolveLfoParameters(effect, device.animation.lfo, {
        time: at.time,
        bpm: at.bpm,
        signature: at.signature,
      });
    } else if (driver.kind === "reactive" && device.animation?.reactive) {
      resolved = resolveReactiveParameters(effect, device.animation.reactive, {
        time: at.time,
        fps: at.fps,
        onsets: at.onsets ?? [],
      });
    }
    const moved = resolved.find((parameter) => parameter.key === key);
    value = moved?.numericValue ?? Number.parseFloat(moved?.value ?? "");
  }
  return Number.isFinite(value) && Math.abs(value - base) > 1e-6
    ? value
    : undefined;
}
