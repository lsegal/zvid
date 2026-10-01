import type { SlotMotion, StackedLayer } from "./composition-layout.ts";
import type { OrderSlide } from "./composition-order.ts";
import { orderSlideWeight } from "./fx-animation-clip.ts";

// Transitions blended at once. Clips entering or exiting at the same moment
// move together, so this is only reached with that many overlapping at
// different moments; any more are drawn settled in their slots.
const MAX_SLOT_TRANSITIONS = 6;

// Weights closer than this move as one transition.
export const TRANSITION_EPSILON = 1e-6;

/**
 * Where each of `stacked`, the layers an animated Order arranges in slot
 * order, is while clips enter and exit. Each layer's weight says how far it
 * has slid in: 1 settled in its slot, 0 not yet in or already out, from its
 * clip's position and the Order's timing. A layer that is entering or
 * exiting slides between its slot and the canvas edge, and every other
 * layer's slot is between the arrangement with it and the one without it,
 * by the same weight. Layers moving at once blend every combination of
 * their arrangements. Layers that are all settled have no motion.
 */
export function resolveSlotMotions<T extends StackedLayer>(
  stacked: readonly T[],
  slide: OrderSlide,
): Map<T, SlotMotion> {
  const weights = stacked.map((layer) => {
    const duration = layer.clip.durationSeconds;
    return duration === undefined || layer.clipProgress === undefined
      ? 1
      : orderSlideWeight(
          slide,
          layer.clipProgress * duration,
          duration,
          layer.sessionEdges,
        );
  });
  // Moving layers, grouped by weight, so clips entering or exiting together
  // move as one.
  const groups: { weight: number; members: Set<number> }[] = [];
  weights.forEach((weight, index) => {
    if (weight >= 1) {
      return;
    }
    const group = groups.find(
      (candidate) => Math.abs(candidate.weight - weight) < TRANSITION_EPSILON,
    );
    if (group) {
      group.members.add(index);
    } else if (groups.length < MAX_SLOT_TRANSITIONS) {
      groups.push({ weight, members: new Set([index]) });
    }
  });
  const motions = new Map<T, SlotMotion>();
  if (!groups.length) {
    return motions;
  }

  const groupOf = (index: number) =>
    groups.findIndex((group) => group.members.has(index));
  // The layer's slots over every combination of the other groups being in
  // or out, with `forced` in.
  const blendSlots = (index: number, forced: number) => {
    const slots = new Map<string, SlotMotion["slots"][number]>();
    for (let mask = 0; mask < 1 << groups.length; mask++) {
      if (forced >= 0 && !(mask & (1 << forced))) {
        continue;
      }
      let weight = 1;
      groups.forEach((group, groupIndex) => {
        if (groupIndex !== forced) {
          weight *= mask & (1 << groupIndex) ? group.weight : 1 - group.weight;
        }
      });
      if (weight <= 0) {
        continue;
      }
      const present = stacked
        .map((_, other) => other)
        .filter((other) => {
          const group = groupOf(other);
          return group < 0 || Boolean(mask & (1 << group));
        });
      const slot = present.indexOf(index);
      // Where a moving layer's slot is among the others without its group.
      const others = present.filter((other) => groupOf(other) !== forced);
      const collapse =
        forced >= 0
          ? {
              boundary: others.filter((other) => other < index).length,
              slotCount: others.length,
            }
          : undefined;
      const key = `${slot}/${present.length}/${collapse?.boundary}/${collapse?.slotCount}`;
      const existing = slots.get(key);
      if (existing) {
        existing.weight += weight;
      } else {
        slots.set(key, {
          slot,
          slotCount: present.length,
          weight,
          ...(collapse ? { collapse } : {}),
        });
      }
    }
    return [...slots.values()];
  };

  stacked.forEach((layer, index) => {
    const group = groupOf(index);
    const slots = blendSlots(index, group);
    const settled =
      group < 0 &&
      slots.length === 1 &&
      slots[0].slot === index &&
      slots[0].slotCount === stacked.length;
    if (!settled) {
      motions.set(layer, {
        slots,
        slide: group < 0 ? 0 : 1 - groups[group].weight,
      });
    }
  });
  return motions;
}
