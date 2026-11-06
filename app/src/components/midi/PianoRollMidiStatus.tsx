import type { MidiInputInfo } from "../../midi-input/input-hub.ts";

function inputLabel({ name, mapping }: MidiInputInfo) {
  return mapping ? `${mapping.manufacturer} ${mapping.model}` : name;
}

// Which MIDI devices are playing the roll, and what each was recognized as.
// Nothing shows without any.
export function PianoRollMidiStatus({
  inputs,
}: {
  inputs: readonly MidiInputInfo[];
}) {
  if (!inputs.length) {
    return null;
  }
  return (
    <span
      className="piano-roll__midi-status"
      data-piano-roll-midi-status
      title={inputs
        .map((input) =>
          input.mapping ? inputLabel(input) : `${input.name}: standard layout`,
        )
        .join("\n")}
    >
      {inputs.length > 1 ? `${inputs.length} MIDI inputs` : inputLabel(inputs[0])}
    </span>
  );
}
