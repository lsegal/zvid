// The traces the Animation section's graph draws (see FxAnimationGraph),
// sampled from what the compositor follows: LFO the same as Modulation's
// (see fx-modulation-trace.ts), Clip the weight across the effect's clip,
// and Reactive the swing of the hits heard on the timeline.

import type { ArrangementClip } from "./app/types.ts";
import { quartersToSeconds } from "./composition-clip-timing.ts";
import { getCompositionEndQ } from "./composition-progress.ts";
import {
  clipAnimationWeight,
  clipSessionEdges,
  ORDER_SLIDE_MOTION,
  type SessionEdges,
} from "./fx-animation-clip.ts";
import type {
  ClipAnimation,
  ReactiveAnimation,
} from "./fx-animation-defaults.ts";
import { type ReactiveOnset, reactiveSwingAt } from "./fx-animation-impulse.ts";
import { transientTraceValue } from "./fx-modulation-trace.ts";
import type { FxDeviceGroup } from "./fx-stack.ts";

// A Clip or Reactive trace spans this long.
export const ANIMATION_TRACE_SECONDS = 2;

// The clip a Clip-mode trace follows, as its animation sees it.
export type AnimationClipSpan = {
  startSeconds: number;
  durationSeconds: number;
  sessionEdges?: SessionEdges;
};

// The time of each of `count` samples over the `seconds` up to `time`,
// oldest first and ending at `time`.
function sampleTimes(
  count: number,
  seconds: number,
  time: number,
  sample: (time: number) => number,
  into: Float32Array,
) {
  const step = count > 1 ? seconds / (count - 1) : 0;
  for (let index = 0; index < count; index++) {
    into[index] = sample(time - (count - 1 - index) * step);
  }
  return into;
}

// `count` samples of Clip mode's weight over the `seconds` up to `time`,
// oldest first: 0..1 mapped onto -1..1, so the ease in, hold and ease out
// fill the trace. Flat at -1 outside `span`, or with none. An Order slides
// its clips with its own easing rather than Motion In and Out.
export function sampleClipTrace(
  clip: Pick<ClipAnimation, "motionIn" | "motionOut" | "transition">,
  frames: number,
  fps: number,
  span: AnimationClipSpan | undefined,
  time: number,
  count: number,
  seconds: number,
  into: Float32Array = new Float32Array(count),
) {
  const motion = clip.transition ? ORDER_SLIDE_MOTION : clip;
  return sampleTimes(
    count,
    seconds,
    time,
    (at) => {
      const elapsed = span ? at - span.startSeconds : -1;
      if (!span || elapsed < 0 || elapsed >= span.durationSeconds) {
        return -1;
      }
      const weight = clipAnimationWeight(
        motion,
        frames,
        fps,
        elapsed,
        span.durationSeconds,
        span.sessionEdges,
      );
      return weight * 2 - 1;
    },
    into,
  );
}

// `count` samples of Reactive mode's swing over the `seconds` up to `time`,
// oldest first: each hit in `onsets` spikes and falls back along the Motion
// envelope `lengthFrames` long at `fps`, scaled by Reactivity and the hit's
// strength, as a fraction of the most that Motion swings.
export function sampleReactiveTrace(
  reactive: Pick<ReactiveAnimation, "motion" | "reactivity">,
  onsets: readonly ReactiveOnset[],
  lengthFrames: number,
  fps: number,
  time: number,
  count: number,
  seconds: number,
  into: Float32Array = new Float32Array(count),
) {
  return sampleTimes(
    count,
    seconds,
    time,
    (at) => {
      const swing = reactiveSwingAt(reactive, onsets, at, lengthFrames, fps);
      return swing ? transientTraceValue(reactive.motion, swing.amount) : 0;
    },
    into,
  );
}

// What the FX panel shows: its layer and clip.
export type AnimationTraceTarget = {
  group: FxDeviceGroup;
  laneId?: string;
  clipId?: string;
};

type SpanClip = Pick<
  ArrangementClip,
  "id" | "laneId" | "startQ" | "durationSeconds"
> & {
  // A piece of a layer clip animates over the whole clip.
  layerClipStartQ?: number;
  layerClipDurationSeconds?: number;
};

// The clip a device's Clip-mode trace follows at `timeSeconds`, as the
// compositor picks it: a clip device's own clip, a layer device's clip at
// the playhead on its layer, and a Global device's topmost clip at the
// playhead (by `lanePriority`). Away from those clips it follows the
// selected clip. The session ends at `sessionEndSeconds`, or else with its
// last clip.
export function findAnimationClipSpan(
  clips: readonly SpanClip[],
  target: AnimationTraceTarget,
  timeSeconds: number,
  bpm: number,
  fps: number,
  lanePriority?: ReadonlyMap<string, number>,
  sessionEndSeconds?: number,
): AnimationClipSpan | undefined {
  const timing = (clip: SpanClip) => ({
    startSeconds: quartersToSeconds(clip.layerClipStartQ ?? clip.startQ, bpm),
    durationSeconds: clip.layerClipDurationSeconds ?? clip.durationSeconds,
  });
  const selected = clips.find((clip) => clip.id === target.clipId);
  let found = target.group === "clip" ? selected : undefined;
  if (!found && target.group !== "clip") {
    // A layer shows the latest-starting of its clips at the playhead.
    const topByLane = new Map<string, SpanClip>();
    for (const clip of clips) {
      const startSeconds = quartersToSeconds(clip.startQ, bpm);
      if (
        timeSeconds < startSeconds ||
        timeSeconds >= startSeconds + clip.durationSeconds ||
        (target.group === "layer" && clip.laneId !== target.laneId)
      ) {
        continue;
      }
      const current = topByLane.get(clip.laneId);
      if (!current || clip.startQ >= current.startQ) {
        topByLane.set(clip.laneId, clip);
      }
    }
    const rank = (clip: SpanClip) =>
      lanePriority?.get(clip.laneId) ?? Number.MAX_SAFE_INTEGER;
    found = [...topByLane.values()].sort(
      (left, right) => rank(left) - rank(right),
    )[0];
    if (
      !found &&
      (target.group === "global" || selected?.laneId === target.laneId)
    ) {
      found = selected;
    }
  }
  if (!found) {
    return undefined;
  }
  const span = timing(found);
  const endSeconds =
    sessionEndSeconds ??
    quartersToSeconds(getCompositionEndQ(clips as SpanClip[], bpm), bpm);
  return {
    ...span,
    sessionEdges: clipSessionEdges(
      span.startSeconds,
      span.durationSeconds,
      endSeconds,
      fps,
    ),
  };
}
