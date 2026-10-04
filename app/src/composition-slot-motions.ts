import type { SlotMotion, StackedLayer } from "./composition-layout.ts";
import type { CompositionOrder, OrderSlide } from "./composition-order.ts";
import type { SlotEntry } from "./composition-squish.ts";
import { orderSlideWeight } from "./fx-animation-clip.ts";

// Transitions blended at once. Clips entering or exiting at the same moment
// move together, so this is only reached with that many overlapping at
// different moments; any more are drawn settled in their slots.
const MAX_SLOT_TRANSITIONS = 6;

// Weights closer than this move as one transition.
export const TRANSITION_EPSILON = 1e-6;

/**
 * The side of `order`'s arrangement a layer enters and leaves from. In a
 * Horizontal or Vertical Order that is its place among the `others` that
 * stay, `before` of them ahead of it: the start edge (left or top) first,
 * the end edge (right or bottom) last, and the middle between them. A Grid
 * goes by the layer's own cell, slot `index`: the left or right edge in the
 * first or last column, else the top or bottom edge in the first or last
 * row, else the middle. A layer with no others enters in the middle.
 */
export function resolveSlotEntry(
  order: CompositionOrder,
  index: number,
  before: number,
  others: number,
): SlotEntry {
  if (order.arrangement === "horizontal" || order.arrangement === "vertical") {
    const [start, end] =
      order.arrangement === "horizontal"
        ? (["left", "right"] as const)
        : (["top", "bottom"] as const);
    return others <= 0
      ? "middle"
      : before <= 0
        ? start
        : before >= others
          ? end
          : "middle";
  }
  if (order.arrangement !== "grid" || others <= 0) {
    return "middle";
  }
  const last = order.gridSize - 1;
  const column = index % order.gridSize;
  const row = Math.floor(index / order.gridSize);
  return column === 0
    ? "left"
    : column === last
      ? "right"
      : row === 0
        ? "top"
        : row === last
          ? "bottom"
          : "middle";
}

/**
 * Where each of `stacked`, the layers an animated Order arranges in slot
 * order, is while clips enter and exit. Each layer's weight says how far it
 * has slid in: 1 settled in its slot, 0 not yet in or already out, from its
 * clip's position and the Order's timing. A layer that is entering or
 * exiting slides between its slot and the canvas edge, and every other
 * layer's slot is between the arrangement with it and the one without it,
 * by the same weight. Layers moving at once blend every combination of
 * their arrangements. Layers that are all settled have no motion. Each
 * moving layer enters and leaves from its `resolveSlotEntry` side of
 * `order`.
 */
export function resolveSlotMotions<T extends StackedLayer>(
  stacked: readonly T[],
  slide: OrderSlide,
  order: CompositionOrder,
): Map<T, SlotMotion> {
  const weights = stacked.map((layer) => {
    // A piece of a layer clip slides in and out with the whole clip.
    const duration =
      layer.clip.layerClipDurationSeconds ?? layer.clip.durationSeconds;
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
  // move as one. A clip entering and one exiting are never together, even
  // at the same weight.
  const groups: { weight: number; exiting: boolean; members: Set<number> }[] =
    [];
  weights.forEach((weight, index) => {
    if (weight >= 1) {
      return;
    }
    const exiting = (stacked[index].clipProgress ?? 0) >= 0.5;
    const group = groups.find(
      (candidate) =>
        candidate.exiting === exiting &&
        Math.abs(candidate.weight - weight) < TRANSITION_EPSILON,
    );
    if (group) {
      group.members.add(index);
    } else if (groups.length < MAX_SLOT_TRANSITIONS) {
      groups.push({ weight, exiting, members: new Set([index]) });
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
    if (settled) {
      return;
    }
    if (group < 0) {
      motions.set(layer, { slots, slide: 0 });
      return;
    }
    const others = stacked
      .map((_, other) => other)
      .filter((other) => groupOf(other) !== group);
    motions.set(layer, {
      slots,
      slide: 1 - groups[group].weight,
      entry: resolveSlotEntry(
        order,
        index,
        others.filter((other) => other < index).length,
        others.length,
      ),
    });
  });
  return motions;
}
