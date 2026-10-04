import { useCallback, useContext, useMemo } from "react";
import {
  type EffectAnimation,
  getAnimationModes,
  getClipTimingFrames,
  getReactiveTimingFrames,
} from "../../fx-animation-defaults";
import { reactiveOnsets, watchReactiveOnsets } from "../../fx-animation-onsets";
import {
  ANIMATION_TRACE_SECONDS,
  findAnimationClipSpan,
  sampleClipTrace,
  sampleReactiveTrace,
} from "../../fx-animation-trace";
import { lfoTraceSeconds, sampleLfoTrace } from "../../fx-modulation-trace";
import type { FxDevice } from "../../fx-stack";
import { FxTraceGraph, TRACE_SAMPLES, type TraceSource } from "./FxTraceGraph";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "./modulation-clock";

type FxAnimationGraphProps = {
  device: FxDevice;
  animation: EffectAnimation;
};

// The trace in the Animation section's title, sampled as the compositor
// animates the effect: LFO's waveform at the playhead, scaled by Depth;
// Reactive's swing on each hit the preview has heard, scaled by Reactivity;
// or Clip's weight across the clip at the playhead, easing in, holding and
// easing out.
export function FxAnimationGraph({ device, animation }: FxAnimationGraphProps) {
  const clock = useContext(FxModulationClockContext);
  const timeline = useContext(FxAnimationTimelineContext);
  const { id, accent, effectName, group } = device;
  // The mode the section shows controls for.
  const { lfo, reactive } = animation;
  const modes = getAnimationModes(effectName);
  const mode =
    (animation.mode === "lfo" && lfo) ||
    (animation.mode === "reactive" && reactive)
      ? modes.includes(animation.mode)
        ? animation.mode
        : "clip"
      : "clip";
  const bpm = clock?.bpm ?? 0;
  const signature = clock?.signature;
  const fps = timeline?.fps ?? 0;

  const shape = lfo?.shape ?? "Sine";
  const sync = lfo?.sync ?? false;
  const rate = lfo?.rate ?? 0;
  const syncRate = lfo?.syncRate ?? "1 Bar";
  const phase = lfo?.phase ?? 0;
  const depth = lfo?.depth ?? 0;
  const seedKey = lfo?.parameters[0] ?? "";
  const sampleLfo = useCallback(
    (time: number, into: Float32Array) => {
      const settings = { shape, sync, rate, syncRate, phase, depth };
      const tempo = { bpm, signature };
      sampleLfoTrace(
        settings,
        { ...tempo, time },
        `${id}\u0000${seedKey}`,
        TRACE_SAMPLES,
        lfoTraceSeconds(settings, tempo),
        into,
      );
    },
    [shape, sync, rate, syncRate, phase, depth, bpm, signature, id, seedKey],
  );

  const motion = reactive?.motion ?? "None";
  const reactivity = reactive?.reactivity ?? 0;
  const reactiveFrames = reactive
    ? getReactiveTimingFrames(effectName, reactive.timing)
    : 0;
  const sampleReactive = useCallback(
    (time: number, into: Float32Array) => {
      sampleReactiveTrace(
        { motion, reactivity },
        reactiveOnsets(),
        reactiveFrames,
        fps,
        time,
        TRACE_SAMPLES,
        ANIMATION_TRACE_SECONDS,
        into,
      );
    },
    [motion, reactivity, reactiveFrames, fps],
  );

  const { motionIn, motionOut, timing, transition } = animation.clip;
  const clipFrames = getClipTimingFrames(effectName, timing);
  const sampleClip = useCallback(
    (time: number, into: Float32Array) => {
      if (clipFrames === undefined || !timeline) {
        into.fill(-1);
        return;
      }
      const span = findAnimationClipSpan(
        timeline.clips,
        { group, laneId: timeline.laneId, clipId: timeline.clipId },
        time,
        bpm,
        timeline.fps,
        timeline.lanePriority,
        timeline.sessionEndSeconds,
      );
      sampleClipTrace(
        { motionIn, motionOut, transition },
        clipFrames,
        timeline.fps,
        span,
        time,
        TRACE_SAMPLES,
        ANIMATION_TRACE_SECONDS,
        into,
      );
    },
    [clipFrames, timeline, group, bpm, motionIn, motionOut, transition],
  );

  const source = useMemo<TraceSource>(
    () =>
      mode === "lfo"
        ? { kind: "window", sample: sampleLfo }
        : mode === "reactive"
          ? {
              kind: "window",
              sample: sampleReactive,
              watch: watchReactiveOnsets,
            }
          : { kind: "window", sample: sampleClip },
    [mode, sampleLfo, sampleReactive, sampleClip],
  );

  return (
    <FxTraceGraph
      accent={accent}
      className="fx-animation-graph"
      source={source}
    />
  );
}
