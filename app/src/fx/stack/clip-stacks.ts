import type { EffectAnimation } from "../../fx-animation-defaults.ts";
import {
  cloneModulation,
  type EffectModulation,
} from "../../fx-modulation-defaults.ts";
import type { FxDeviceGroup } from "./types.ts";

export const GLOBAL_EFFECT_TRACK_ID = "__group_main";

// A clip's own stack is keyed by its clip id, so it follows the clip to
// another layer and survives save/load and collaboration with the clip.
const CLIP_EFFECT_TRACK_PREFIX = "clip:";

export function clipEffectTrackId(clipId: string) {
  return `${CLIP_EFFECT_TRACK_PREFIX}${clipId}`;
}

// The clip a clip stack belongs to, or undefined for a layer or the Global
// stack.
export function getEffectClipId(trackId: string) {
  return trackId.startsWith(CLIP_EFFECT_TRACK_PREFIX)
    ? trackId.slice(CLIP_EFFECT_TRACK_PREFIX.length)
    : undefined;
}

// A source track's and a source clip's own stacks are keyed by their ids in
// namespaces of their own, so they are never taken for an arrangement layer
// or clip. They apply where the source tracks render in place of layers.
const SOURCE_TRACK_EFFECT_TRACK_PREFIX = "source-track:";
const SOURCE_CLIP_EFFECT_TRACK_PREFIX = "source-clip:";

export function sourceTrackEffectTrackId(sourceTrackId: string) {
  return `${SOURCE_TRACK_EFFECT_TRACK_PREFIX}${sourceTrackId}`;
}

export function sourceClipEffectTrackId(sourceSpanId: string) {
  return `${SOURCE_CLIP_EFFECT_TRACK_PREFIX}${sourceSpanId}`;
}

// The source track a source track stack belongs to, or undefined for any
// other stack.
export function getEffectSourceTrackId(trackId: string) {
  return trackId.startsWith(SOURCE_TRACK_EFFECT_TRACK_PREFIX)
    ? trackId.slice(SOURCE_TRACK_EFFECT_TRACK_PREFIX.length)
    : undefined;
}

// The source clip (span) a source clip stack belongs to, or undefined for
// any other stack.
export function getEffectSourceSpanId(trackId: string) {
  return trackId.startsWith(SOURCE_CLIP_EFFECT_TRACK_PREFIX)
    ? trackId.slice(SOURCE_CLIP_EFFECT_TRACK_PREFIX.length)
    : undefined;
}

// A source track's stack is track-level, like a layer's, and a source
// clip's is clip-level, like a layer clip's.
export function getTrackGroup(trackId: string): FxDeviceGroup {
  if (trackId === GLOBAL_EFFECT_TRACK_ID) {
    return "global";
  }

  return getEffectClipId(trackId) === undefined &&
    getEffectSourceSpanId(trackId) === undefined
    ? "layer"
    : "clip";
}

export function cloneAnimation(animation: EffectAnimation): EffectAnimation {
  return {
    ...animation,
    clip: { ...animation.clip },
    ...(animation.reactive
      ? {
          reactive: {
            ...animation.reactive,
            parameters: [...animation.reactive.parameters],
          },
        }
      : {}),
    ...(animation.lfo
      ? {
          lfo: {
            ...animation.lfo,
            parameters: [...animation.lfo.parameters],
          },
        }
      : {}),
  };
}

type StackEffect = {
  id: string;
  trackId: string;
  parameters: readonly object[];
};

// Gives each `[fromClipId, toClipId]` copy of a clip the source clip's stack,
// with new effect ids, in place of any stack the copy had. The stacks are
// read from `source`, such as a clipboard snapshot of clips that were cut
// since, and default to `effects`. Returns `effects` itself when no source
// clip has a stack.
export function copyClipEffects<T extends StackEffect>(
  effects: T[],
  copies: Iterable<readonly [string, string]>,
  source: readonly T[] = effects,
  createId: () => string = () => crypto.randomUUID(),
) {
  return copyEffectStacks(
    effects,
    Array.from(copies, ([fromClipId, toClipId]) => [
      clipEffectTrackId(fromClipId),
      clipEffectTrackId(toClipId),
    ]),
    source,
    createId,
  );
}

// Gives each `[fromTrackId, toTrackId]` stack a copy of the `fromTrackId`
// stack read from `source`, with new effect ids, in place of any it had.
// Returns `effects` itself when no source stack has effects.
export function copyEffectStacks<T extends StackEffect>(
  effects: T[],
  copies: Iterable<readonly [string, string]>,
  source: readonly T[] = effects,
  createId: () => string = () => crypto.randomUUID(),
) {
  let result = effects;
  for (const [fromTrackId, toTrackId] of copies) {
    const stack = source.filter((effect) => effect.trackId === fromTrackId);
    if (!stack.length || fromTrackId === toTrackId) {
      continue;
    }

    result = [
      ...result.filter((effect) => effect.trackId !== toTrackId),
      ...stack.map(
        (effect) =>
          ({
            ...effect,
            id: createId(),
            trackId: toTrackId,
            parameters: effect.parameters.map((parameter) => ({
              ...parameter,
            })),
            ...("animation" in effect && effect.animation
              ? {
                  animation: cloneAnimation(
                    effect.animation as EffectAnimation,
                  ),
                }
              : {}),
            ...("modulation" in effect && effect.modulation
              ? {
                  modulation: cloneModulation(
                    effect.modulation as EffectModulation,
                  ),
                }
              : {}),
          }) as T,
      ),
    ];
  }
  return result;
}

// The effects a Ctrl/Cmd-drag duplicate is drawn with before it is dropped:
// the in-flight copy borrows its source clip's stack, so it looks as it will
// once dropped. Nothing is committed; the drop copies the stack for real
// with `copyClipEffects`. The ids are stable across calls, so redrawing the
// drag doesn't churn them. Returns `effects` itself when the source clip has
// no stack.
export function previewDuplicateClipEffects<T extends StackEffect>(
  effects: T[],
  sourceClipId: string,
  copyClipId: string,
) {
  let next = 0;
  return copyClipEffects(
    effects,
    [[sourceClipId, copyClipId]],
    effects,
    () => `${clipEffectTrackId(copyClipId)}:preview-${++next}`,
  );
}

// Drops the stacks of clips that are gone, so deleting a clip deletes its
// effects. Returns `effects` itself when every clip stack still has its clip.
export function pruneClipEffects<T extends { trackId: string }>(
  effects: T[],
  clips: readonly { id: string }[],
) {
  const clipIds = new Set(clips.map((clip) => clip.id));
  const isOrphan = (effect: T) => {
    const clipId = getEffectClipId(effect.trackId);
    return clipId !== undefined && !clipIds.has(clipId);
  };
  return effects.some(isOrphan)
    ? effects.filter((effect) => !isOrphan(effect))
    : effects;
}

// The effects with each clip stack moved to the clip's new id in `clipIds`,
// such as the ids clips are saved under. Other stacks keep their track.
export function renameClipEffectTracks<T extends { trackId: string }>(
  effects: T[],
  clipIds: ReadonlyMap<string, string>,
) {
  return effects.map((effect) => {
    const clipId = getEffectClipId(effect.trackId);
    const renamed = clipId === undefined ? undefined : clipIds.get(clipId);
    return renamed === undefined || renamed === clipId
      ? effect
      : { ...effect, trackId: clipEffectTrackId(renamed) };
  });
}

// Drops the stacks of source tracks and source clips that are gone, so
// deleting either deletes its effects. Returns `effects` itself when every
// source stack still has its track or clip.
export function pruneSourceEffects<T extends { trackId: string }>(
  effects: T[],
  sourceTracks: readonly { id: string }[],
  sourceSpans: readonly { id: string }[],
) {
  const trackIds = new Set(sourceTracks.map((track) => track.id));
  const spanIds = new Set(sourceSpans.map((span) => span.id));
  const isOrphan = (effect: T) => {
    const trackId = getEffectSourceTrackId(effect.trackId);
    if (trackId !== undefined) {
      return !trackIds.has(trackId);
    }
    const spanId = getEffectSourceSpanId(effect.trackId);
    return spanId !== undefined && !spanIds.has(spanId);
  };
  return effects.some(isOrphan)
    ? effects.filter((effect) => !isOrphan(effect))
    : effects;
}

// The effects with each source clip stack moved to its span's new id in
// `spanIds`, such as the ids spans are saved under. Other stacks keep their
// track.
export function renameSourceClipEffectTracks<T extends { trackId: string }>(
  effects: T[],
  spanIds: ReadonlyMap<string, string>,
) {
  return effects.map((effect) => {
    const spanId = getEffectSourceSpanId(effect.trackId);
    const renamed = spanId === undefined ? undefined : spanIds.get(spanId);
    return renamed === undefined || renamed === spanId
      ? effect
      : { ...effect, trackId: sourceClipEffectTrackId(renamed) };
  });
}
