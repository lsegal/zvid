// Session effects grouped by stack once per state change, so each clip at
// each frame animates and scans only the stacks that apply to it: its own,
// its layer's and the Global stack.
import { GLOBAL_EFFECT_TRACK_ID } from "./fx/stack/clip-stacks.ts";

type StackEffect = { trackId: string };

export type EffectIndex<T extends StackEffect> = {
  readonly effects: readonly T[];
  readonly byTrack: ReadonlyMap<string, T[]>;
  // The Global and layer stacks' effects in session order, by layer, made
  // the first time a layer needs them.
  readonly layerStacks: Map<string, T[]>;
};

export function indexEffects<T extends StackEffect>(
  effects: readonly T[],
): EffectIndex<T> {
  const byTrack = new Map<string, T[]>();
  for (const effect of effects) {
    const stack = byTrack.get(effect.trackId);
    if (stack) {
      stack.push(effect);
    } else {
      byTrack.set(effect.trackId, [effect]);
    }
  }
  return { effects, byTrack, layerStacks: new Map() };
}

export function isEffectIndex<T extends StackEffect>(
  value: readonly T[] | EffectIndex<T>,
): value is EffectIndex<T> {
  return !Array.isArray(value);
}

// The effects on one stack, in session order.
export function stackEffects<T extends StackEffect>(
  index: EffectIndex<T>,
  trackId: string,
): T[] {
  return index.byTrack.get(trackId) ?? [];
}

// The effects a clip on `laneId` with the `clipTrackId` stack is drawn
// with: the Global and layer stacks in session order, then the clip's own
// stack last, so it overrides theirs.
export function clipStackEffects<T extends StackEffect>(
  index: EffectIndex<T>,
  laneId: string,
  clipTrackId: string,
): T[] {
  let layerStack = index.layerStacks.get(laneId);
  if (!layerStack) {
    layerStack = index.effects.filter(
      (effect) =>
        effect.trackId === laneId || effect.trackId === GLOBAL_EFFECT_TRACK_ID,
    );
    index.layerStacks.set(laneId, layerStack);
  }
  const clipStack = index.byTrack.get(clipTrackId);
  return clipStack ? [...layerStack, ...clipStack] : layerStack;
}
