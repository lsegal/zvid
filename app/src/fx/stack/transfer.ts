// Moving and copying effects between stacks, for the FX panel's Cut, Copy,
// Paste, Move to Global / Layer / Clip and Clear All. Like the rest of the
// stack helpers these are pure and return `effects` itself when nothing
// changed.

import { isOrderEffectName } from "../../composition-order.ts";
import { cloneModulation } from "../../fx-modulation-defaults.ts";
import { type FxEffectScope, isEffectSupportedIn } from "../../fx-registry.ts";
import { cloneAnimation, getTrackGroup } from "./clip-stacks.ts";
import { isLayerLayoutEffect, isLayoutEffectName } from "./layer-fx.ts";
import type { SessionEffect } from "./types.ts";

// A copy of `source` on the `trackId` stack under a new id, with its
// parameters, bypass state, animation and modulation.
export function copyEffect(
  source: SessionEffect,
  trackId: string,
  id: string = crypto.randomUUID(),
): SessionEffect {
  const { defaulted: _defaulted, ...rest } = source;
  return {
    ...rest,
    id,
    trackId,
    parameters: source.parameters.map((parameter) => ({ ...parameter })),
    ...(source.animation
      ? { animation: cloneAnimation(source.animation) }
      : {}),
    ...(source.modulation
      ? { modulation: cloneModulation(source.modulation) }
      : {}),
  };
}

// Whether an `effectName` effect can join the `trackId` stack, whose scope
// is `scope`: its definition must support the scope, and a layer keeps a
// single Layout.
export function canPlaceEffect(
  effects: readonly SessionEffect[],
  effectName: string,
  trackId: string,
  scope: FxEffectScope = getTrackGroup(trackId),
) {
  if (!isEffectSupportedIn(effectName, scope)) {
    return false;
  }

  return (
    !isLayoutEffectName(effectName) ||
    !effects.some(
      (effect) =>
        effect.trackId === trackId && isLayoutEffectName(effect.effectName),
    )
  );
}

// Appends `effect` to the end of its own `trackId` stack. A stack arranges
// its layers one way, so an enabled Order bypasses the Orders already there,
// as adding one does.
export function placeEffect(
  effects: SessionEffect[],
  effect: SessionEffect,
  scope: FxEffectScope = getTrackGroup(effect.trackId),
) {
  if (
    effects.some((candidate) => candidate.id === effect.id) ||
    !canPlaceEffect(effects, effect.effectName, effect.trackId, scope)
  ) {
    return effects;
  }

  const bypassOrders =
    isOrderEffectName(effect.effectName) && effect.enabled !== false;
  const current = bypassOrders
    ? effects.map((candidate) =>
        candidate.trackId === effect.trackId &&
        isOrderEffectName(candidate.effectName) &&
        candidate.enabled !== false
          ? { ...candidate, enabled: false }
          : candidate,
      )
    : effects;
  const last = current.findLastIndex(
    (candidate) => candidate.trackId === effect.trackId,
  );
  const insertAt = last < 0 ? current.length : last + 1;
  return [...current.slice(0, insertAt), effect, ...current.slice(insertAt)];
}

// Moves an effect to the end of another stack, keeping its id and
// settings. A layer's own Layout stays on its layer, and an effect only
// moves to a stack that can take it.
export function moveEffectToStack(
  effects: SessionEffect[],
  effectId: string,
  toTrackId: string,
  scope: FxEffectScope = getTrackGroup(toTrackId),
) {
  const effect = effects.find((candidate) => candidate.id === effectId);
  if (!effect || effect.trackId === toTrackId || isLayerLayoutEffect(effect)) {
    return effects;
  }

  const { defaulted: _defaulted, ...moved } = effect;
  const result = placeEffect(
    effects.filter((candidate) => candidate !== effect),
    { ...moved, trackId: toTrackId },
    scope,
  );
  return result.some((candidate) => candidate.id === effectId)
    ? result
    : effects;
}

// Removes the effects with the given ids, apart from a layer's own Layout.
export function removeEffects(
  effects: SessionEffect[],
  effectIds: Iterable<string>,
) {
  const removed = new Set(effectIds);
  const result = effects.filter(
    (effect) => !removed.has(effect.id) || isLayerLayoutEffect(effect),
  );
  return result.length === effects.length ? effects : result;
}
