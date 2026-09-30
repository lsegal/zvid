import type { EffectAnimation } from "../../fx-animation-defaults.ts";
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

export function getTrackGroup(trackId: string): FxDeviceGroup {
  if (trackId === GLOBAL_EFFECT_TRACK_ID) {
    return "global";
  }

  return getEffectClipId(trackId) === undefined ? "layer" : "clip";
}

export function cloneAnimation(animation: EffectAnimation): EffectAnimation {
  return {
    ...animation,
    clip: { ...animation.clip },
    reactive: {
      ...animation.reactive,
      parameters: [...animation.reactive.parameters],
    },
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
  let result = effects;
  for (const [fromClipId, toClipId] of copies) {
    const fromTrackId = clipEffectTrackId(fromClipId);
    const toTrackId = clipEffectTrackId(toClipId);
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
