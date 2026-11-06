import { useId, useSyncExternalStore } from "react";
import { computerKeyboardEntry } from "../../midi-input/computer-keyboard.ts";
import { midiInputHub } from "../../midi-input/input-hub.ts";
import {
  RECORD_QUANTIZE_VALUES,
  type RecordQuantize,
  recordQuantizeLabel,
} from "../../recording/midi-quantize.ts";
import {
  type RecordMidiInput,
  type RecordSource,
  setRecordSourcePrefs,
  useRecordSourcePrefs,
} from "../../recording/record-source.ts";
import { PianoRollMidiControls } from "../midi/PianoRollMidiControls";
import { Select } from "../ui/select";
import "../midi/midi-devices.css";
import "./record-midi-panel.css";

const QUANTIZE_OPTIONS = RECORD_QUANTIZE_VALUES.map((value) => ({
  value,
  label: recordQuantizeLabel(value),
}));

const SOURCE_LABELS: Record<RecordSource, string> = {
  media: "Video/Audio",
  midi: "MIDI",
};

// The record panels' choice of what armed tracks record, while MIDI is on.
export function RecordSourceTabs({ source }: { source: RecordSource }) {
  return (
    <div
      aria-label="Record source"
      className="segmented-control record-source-tabs"
      role="tablist"
    >
      {(["media", "midi"] as const).map((option) => (
        <button
          aria-selected={source === option}
          className={source === option ? "is-active" : ""}
          key={option}
          onClick={() => setRecordSourcePrefs({ source: option })}
          role="tab"
          type="button"
        >
          {SOURCE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

// The MIDI tab: the device or the typing keyboard to record from, and the
// grid recorded notes land on.
export function RecordMidiPanel() {
  const { midiInput, quantize } = useRecordSourcePrefs();
  const midi = useSyncExternalStore(
    midiInputHub.subscribe,
    midiInputHub.getState,
  );
  const name = useId();
  const chooseInput = (input: RecordMidiInput) => {
    setRecordSourcePrefs({ midiInput: input });
    if (input === "keyboard") {
      computerKeyboardEntry.setEnabled(true);
    }
  };
  return (
    <div className="record-midi-panel">
      <fieldset className="record-midi-panel__source">
        <legend>Source</legend>
        <div className="record-midi-panel__option">
          <label>
            <input
              checked={midiInput === "device"}
              name={name}
              onChange={() => chooseInput("device")}
              type="radio"
            />
            MIDI device
          </label>
          {midiInput === "device" ? (
            <PianoRollMidiControls hub={midiInputHub} state={midi} />
          ) : null}
        </div>
        <div className="record-midi-panel__option">
          <label>
            <input
              checked={midiInput === "keyboard"}
              name={name}
              onChange={() => chooseInput("keyboard")}
              type="radio"
            />
            Computer keyboard
          </label>
        </div>
      </fieldset>
      <div className="record-midi-panel__quantize">
        <span>Quantize</span>
        <Select<RecordQuantize>
          aria-label="Quantize"
          onValueChange={(value) => setRecordSourcePrefs({ quantize: value })}
          options={QUANTIZE_OPTIONS}
          value={quantize}
        />
      </div>
    </div>
  );
}
