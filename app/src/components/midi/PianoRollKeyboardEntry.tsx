import type { ComputerKeyboardState } from "../../midi-input/computer-keyboard.ts";
import { pitchName } from "../../midi-piano-roll.ts";

// While the typing keyboard plays notes, the piano roll header names the C
// that the A key plays.
export function PianoRollKeyboardEntry({
  state: { enabled, basePitch },
}: {
  state: ComputerKeyboardState;
}) {
  if (!enabled) {
    return null;
  }
  const pitch = pitchName(basePitch);
  return (
    <span
      className="piano-roll__keyboard-octave"
      title={`The A key plays ${pitch}. Z and X shift the octave.`}
    >
      {pitch}
    </span>
  );
}
