// The piano roll's velocity lane: the velocity a point of the lane sets, the
// notes a drag paints or shifts, and the lane's height, which is kept in
// localStorage.
import type { MidiNote } from "./midi-clip.ts";

export const VELOCITY_MIN = 1;
export const VELOCITY_MAX = 127;
// The lane's height range and its default.
export const VELOCITY_LANE_MIN_PX = 24;
export const VELOCITY_LANE_MAX_PX = 160;
export const VELOCITY_LANE_DEFAULT_PX = 56;
export const VELOCITY_LANE_STORAGE_KEY = "zvid.pianoRoll.velocityLaneHeight";
// How far either side of a note's stem a press or a paint still reaches it.
export const VELOCITY_STEM_REACH_PX = 4;

/** `velocity` rounded and clamped to MIDI's 1 to 127. */
export function clampVelocity(velocity: number) {
  return Math.min(
    VELOCITY_MAX,
    Math.max(VELOCITY_MIN, Math.round(velocity)),
  );
}

/** The velocity at `offsetY` pixels down a lane `heightPx` tall. */
export function velocityAt(offsetY: number, heightPx: number) {
  return clampVelocity(
    ((heightPx - offsetY) / Math.max(1, heightPx)) * VELOCITY_MAX,
  );
}

/**
 * The indexes of the notes whose stems, `quarterPx` per quarter, lie from
 * `fromX` to `toX` pixels, give or take the stem's reach.
 */
export function stemsBetween(
  notes: readonly MidiNote[],
  fromX: number,
  toX: number,
  quarterPx: number,
) {
  const low = Math.min(fromX, toX) - VELOCITY_STEM_REACH_PX;
  const high = Math.max(fromX, toX) + VELOCITY_STEM_REACH_PX;
  const indexes: number[] = [];
  notes.forEach((note, index) => {
    const x = note.start * quarterPx;
    if (x >= low && x <= high) {
      indexes.push(index);
    }
  });
  return indexes;
}

/**
 * `notes` with the stems a paint stroke crossed set along it: from velocity
 * `fromVelocity` at `fromX` to `toVelocity` at `toX`.
 */
export function paintVelocities(
  notes: readonly MidiNote[],
  from: { x: number; velocity: number },
  to: { x: number; velocity: number },
  quarterPx: number,
) {
  const indexes = new Set(stemsBetween(notes, from.x, to.x, quarterPx));
  if (!indexes.size) {
    return [...notes];
  }
  const span = to.x - from.x;
  return notes.map((note, index) => {
    if (!indexes.has(index)) {
      return note;
    }
    const along = span
      ? Math.min(1, Math.max(0, (note.start * quarterPx - from.x) / span))
      : 1;
    const velocity = clampVelocity(
      from.velocity + (to.velocity - from.velocity) * along,
    );
    return velocity === note.velocity ? note : { ...note, velocity };
  });
}

/**
 * `base` with every note whose index is in `indexes` shifted by `delta`,
 * each clamped on its own.
 */
export function shiftVelocities(
  base: readonly MidiNote[],
  indexes: ReadonlySet<number>,
  delta: number,
) {
  return base.map((note, index) => {
    if (!indexes.has(index)) {
      return note;
    }
    const velocity = clampVelocity(note.velocity + delta);
    return velocity === note.velocity ? note : { ...note, velocity };
  });
}

/** `height` rounded and clamped to the lane's range. */
export function clampVelocityLaneHeight(height: number) {
  return Math.round(
    Math.min(VELOCITY_LANE_MAX_PX, Math.max(VELOCITY_LANE_MIN_PX, height)),
  );
}

export function readVelocityLaneHeight() {
  if (typeof window === "undefined") {
    return VELOCITY_LANE_DEFAULT_PX;
  }
  try {
    const stored = Number(
      window.localStorage.getItem(VELOCITY_LANE_STORAGE_KEY) ?? Number.NaN,
    );
    return Number.isFinite(stored)
      ? clampVelocityLaneHeight(stored)
      : VELOCITY_LANE_DEFAULT_PX;
  } catch {
    return VELOCITY_LANE_DEFAULT_PX;
  }
}

export function saveVelocityLaneHeight(height: number) {
  try {
    window.localStorage.setItem(VELOCITY_LANE_STORAGE_KEY, String(height));
  } catch {
    // Storage can be unavailable (private mode, quota); resizing still works.
  }
}
