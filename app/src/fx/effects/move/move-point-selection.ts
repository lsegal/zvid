// The Move point being edited, shared by the preview's path dots and the
// Move device's point chips, so picking one picks the other.
import { useSyncExternalStore } from "react";
import type { MovePoint } from "./move-edit.ts";

const points = new Map<string, MovePoint>();
let activeEffectId: string | undefined;
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion() {
  return version;
}

// Selects `point` on Move `effectId`, which becomes the Move whose path the
// preview draws when its clip has several.
export function selectMovePoint(effectId: string, point: MovePoint) {
  if (points.get(effectId) === point && activeEffectId === effectId) {
    return;
  }
  points.set(effectId, point);
  activeEffectId = effectId;
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function readMovePoint(effectId: string): MovePoint {
  return points.get(effectId) ?? "start";
}

export function readActiveMoveEffectId() {
  return activeEffectId;
}

// Re-renders the caller whenever the selection changes.
export function useMovePointSelection() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return { read: readMovePoint, activeEffectId, select: selectMovePoint };
}
