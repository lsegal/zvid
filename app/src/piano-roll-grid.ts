// The piano roll's grid size: a note value from a quarter down to a
// thirty-second triplet, the ladder record quantize offers, or Adaptive,
// which follows the roll's zoom. The grid as viewed is what the roll draws,
// what its edits snap to, and how long a painted note is.
import {
  divisionsPerQ,
  RECORD_QUANTIZE_VALUES,
} from "./recording/midi-quantize.ts";
import {
  GRID_COARSEST,
  GRID_FINEST,
  type GridDivision,
} from "./timeline-grid.ts";

export const PIANO_ROLL_GRIDS = [
  "adaptive",
  ...RECORD_QUANTIZE_VALUES.filter((value) => value !== "off"),
] as const;

export type PianoRollGrid = (typeof PIANO_ROLL_GRIDS)[number];

// Adaptive never draws a cell narrower than this.
export const PIANO_ROLL_MIN_CELL_PX = 32;

// The finest straight note value, 1/1 to 1/32, whose cell is at least
// PIANO_ROLL_MIN_CELL_PX wide with quarters `quarterPx` wide, or a whole note
// when even that is narrower.
function adaptiveDivision(quarterPx: number): GridDivision {
  let division: number = GRID_FINEST;
  while (
    division > GRID_COARSEST &&
    (4 / division) * quarterPx < PIANO_ROLL_MIN_CELL_PX - 1e-9
  ) {
    division /= 2;
  }
  return division as GridDivision;
}

/** The cells per quarter note of `grid` with quarters `quarterPx` wide. */
export function pianoRollCellsPerQ(grid: PianoRollGrid, quarterPx: number) {
  return grid === "adaptive"
    ? adaptiveDivision(quarterPx) / 4
    : divisionsPerQ(grid);
}

/**
 * `grid`'s name in the roll's grid menu; Adaptive's says the note value it
 * resolves to with quarters `quarterPx` wide.
 */
export function pianoRollGridLabel(grid: PianoRollGrid, quarterPx: number) {
  return grid === "adaptive"
    ? `Adaptive (1/${adaptiveDivision(quarterPx)})`
    : grid;
}
