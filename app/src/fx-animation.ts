// Where an effect's Animation modifier changes the parameters it is drawn
// with. The Clip and Reactive engines plug in behind
// `resolveAnimatedParameters` from their own modules; an effect in a mode
// without an engine is drawn with its parameters as they are.

import { resolveClipAnimatedParameters } from "./fx-animation-clip.ts";
import type { EffectAnimation } from "./fx-animation-defaults.ts";
import {
  placeOnsets,
  resolveReactiveParameters,
} from "./fx-animation-reactive.ts";
import type { AudioBands } from "./fx-shaders/audio-bands.ts";

export type AnimatedParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

export type AnimatableEffect = {
  id?: string;
  effectName: string;
  parameters: AnimatedParameter[];
  animation?: EffectAnimation;
};

// The clip an effect is being drawn for.
export type AnimationClipContext = {
  clipId: string;
  laneId: string;
  // How far through the clip the playhead is, 0..1.
  progress: number;
  elapsedSeconds: number;
  durationSeconds: number;
};

// The frame being drawn.
export type AnimationFrameContext = {
  playheadQ: number;
  bpm: number;
  // The session's frame rate, which animation timings are counted in.
  fps: number;
  // The main audio at this frame, which Reactive mode follows.
  audio?: AudioBands;
};

// Whether `effect`'s animation follows the main audio.
export function reactsToAudio(effect: Pick<AnimatableEffect, "animation">) {
  return (
    effect.animation?.enabled === true && effect.animation.mode === "reactive"
  );
}

// The parameters `effect` is drawn with for the clip and frame. Returns
// `effect.parameters` itself when its animation changes nothing, which is
// always the case while it is off.
export function resolveAnimatedParameters(
  effect: AnimatableEffect,
  clipContext: AnimationClipContext,
  frameContext: AnimationFrameContext,
): AnimatedParameter[] {
  const animation = effect.animation;
  if (animation?.mode === "clip") {
    return resolveClipAnimatedParameters(effect, clipContext, frameContext);
  }
  if (animation && reactsToAudio(effect)) {
    const time =
      frameContext.bpm > 0
        ? (frameContext.playheadQ * 60) / frameContext.bpm
        : 0;
    return resolveReactiveParameters(effect, animation.reactive, {
      time,
      fps: frameContext.fps,
      onsets: placeOnsets(frameContext.audio?.onsets, time),
    });
  }
  return effect.parameters;
}

// `effects` with each effect's parameters resolved for the clip and frame.
// Returns `effects` itself when no parameters changed.
export function resolveAnimatedEffects<T extends AnimatableEffect>(
  effects: T[],
  clipContext: AnimationClipContext,
  frameContext: AnimationFrameContext,
): T[] {
  let result: T[] | undefined;
  effects.forEach((effect, index) => {
    if (!effect.animation?.enabled) {
      return;
    }
    const parameters = resolveAnimatedParameters(
      effect,
      clipContext,
      frameContext,
    );
    if (parameters !== effect.parameters) {
      result ??= effects.slice();
      result[index] = { ...effect, parameters };
    }
  });
  return result ?? effects;
}
