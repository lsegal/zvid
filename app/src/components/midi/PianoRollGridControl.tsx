import {
  PIANO_ROLL_GRIDS,
  type PianoRollGrid,
  pianoRollGridLabel,
} from "../../piano-roll-grid.ts";
import { Select } from "../ui/select";

// The piano roll header's grid size menu, Adaptive naming the note value the
// zoom resolves it to.
export function PianoRollGridControl({
  grid,
  quarterPx,
  onChange,
}: {
  grid: PianoRollGrid;
  quarterPx: number;
  onChange: (grid: PianoRollGrid) => void;
}) {
  return (
    <Select
      aria-label="Grid size"
      className="piano-roll__midi-device"
      contentClassName="piano-roll__grid-size-list"
      onValueChange={onChange}
      options={PIANO_ROLL_GRIDS.map((value) => ({
        value,
        label: pianoRollGridLabel(value, quarterPx),
      }))}
      value={grid}
    />
  );
}
