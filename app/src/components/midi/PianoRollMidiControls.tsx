import {
  findChosenInput,
  type MidiInputHub,
  type MidiInputState,
  midiInputLabel,
} from "../../midi-input/input-hub.ts";
import { Select, type SelectOption } from "../ui/select";
import { PianoRollMidiStatus } from "./PianoRollMidiStatus";

const ALL_DEVICES = "all";
const MISSING_DEVICE = "missing";
const NO_CHOICE = "none";
const INPUT_VALUE_PREFIX = "input:";

const ACCESS_MESSAGES = {
  requesting: "Requesting MIDI access",
  unavailable: "MIDI unavailable",
  denied: "MIDI permission denied",
};

/** Whether `target` is in the controls, including the device list's portal. */
export function isMidiControl(target: EventTarget) {
  return Boolean(
    (target as Element).closest(
      "[data-piano-roll-midi-controls], .piano-roll__midi-device-list",
    ),
  );
}

// The device selector's options and value, or a single message in their place
// when there's nothing to choose from.
function deviceSelection({ enabled, device, access, inputs }: MidiInputState) {
  const allDevices = { value: ALL_DEVICES, label: "All devices" };
  const only = (label: string) => ({
    value: NO_CHOICE,
    options: [{ value: NO_CHOICE, label }],
    disabled: true,
  });
  if (!enabled) {
    return only(device?.name ?? allDevices.label);
  }
  if (access !== "ready" && access !== "idle") {
    return only(ACCESS_MESSAGES[access]);
  }
  if (!inputs.length && !device) {
    return only("No MIDI devices");
  }
  const options: SelectOption<string>[] = [
    allDevices,
    ...inputs.map((input) => ({
      value: `${INPUT_VALUE_PREFIX}${input.id}`,
      label: midiInputLabel(input),
    })),
  ];
  if (!device) {
    return { value: ALL_DEVICES, options, disabled: false };
  }
  const chosen = findChosenInput(inputs, device);
  if (chosen) {
    return {
      value: `${INPUT_VALUE_PREFIX}${chosen.id}`,
      options,
      disabled: false,
    };
  }
  options.push({
    value: MISSING_DEVICE,
    label: `${device.name} (not connected)`,
  });
  return { value: MISSING_DEVICE, options, disabled: false };
}

// The piano roll header's MIDI on/off toggle and device selector. With every
// device on, the status beside them says which ones are playing the roll.
export function PianoRollMidiControls({
  hub,
  state,
}: {
  hub: MidiInputHub;
  state: MidiInputState;
}) {
  const { enabled, device, inputs } = state;
  const selection = deviceSelection(state);
  function choose(value: string) {
    if (value === ALL_DEVICES) {
      hub.chooseDevice(null);
      return;
    }
    const input = inputs.find(
      ({ id }) => `${INPUT_VALUE_PREFIX}${id}` === value,
    );
    if (input) {
      hub.chooseDevice({ id: input.id, name: input.name });
    }
  }
  return (
    <div
      className="piano-roll__midi-controls"
      data-fx-no-drag
      data-piano-roll-midi-controls
    >
      {enabled && !device ? <PianoRollMidiStatus inputs={inputs} /> : null}
      <button
        aria-label="MIDI input"
        aria-pressed={enabled}
        className="piano-roll__midi-toggle"
        onClick={() => hub.setEnabled(!enabled)}
        title={enabled ? "Turn MIDI input off" : "Turn MIDI input on"}
        type="button"
      >
        MIDI
      </button>
      <Select
        aria-label="MIDI device"
        className="piano-roll__midi-device"
        contentClassName="piano-roll__midi-device-list"
        disabled={selection.disabled}
        onValueChange={choose}
        options={selection.options}
        value={selection.value}
      />
    </div>
  );
}
