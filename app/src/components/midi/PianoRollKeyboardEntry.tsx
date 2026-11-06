import type {
  ComputerKeyboardEntry,
  ComputerKeyboardState,
} from "../../midi-input/computer-keyboard.ts";
import { pitchName } from "../../midi-piano-roll.ts";

// The piano roll header's toggle for playing notes from the typing keyboard.
// While it's on it names the C that the A key plays.
export function PianoRollKeyboardEntry({
  entry,
  state: { enabled, basePitch },
}: {
  entry: ComputerKeyboardEntry;
  state: ComputerKeyboardState;
}) {
  return (
    <button
      aria-label="Computer keyboard note entry"
      aria-pressed={enabled}
      className="piano-roll__midi-toggle"
      onClick={() => entry.setEnabled(!enabled)}
      title={
        enabled
          ? "Turn computer keyboard note entry off (Z and X shift the octave)"
          : "Play notes from the computer keyboard"
      }
      type="button"
    >
      {enabled ? `Keys ${pitchName(basePitch)}` : "Keys"}
    </button>
  );
}
