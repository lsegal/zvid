import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import { useContext } from "react";
import type {
  ComputerKeyboardEntry,
  ComputerKeyboardState,
} from "../../midi-input/computer-keyboard.ts";
import type {
  MidiInputHub,
  MidiInputState,
} from "../../midi-input/input-hub.ts";
import type { PianoRollGrid } from "../../piano-roll-grid.ts";
import { MidiMapContext, useKeyMapControls } from "../fx/key-map-context";
import { KeyInputControl, MidiInputControl } from "../InputModeControl";
import { PianoRollGridControl } from "./PianoRollGridControl";
import { PianoRollKeyboardEntry } from "./PianoRollKeyboardEntry";
import { isMidiControl, PianoRollMidiControls } from "./PianoRollMidiControls";

// The open piano roll's title bar: its grid size, MIDI and typing keyboard
// controls, and the collapse button, which double-clicking the bar presses
// too.
export function PianoRollHeader({
  grid,
  onGridChange,
  quarterPx,
  midiHub,
  midi,
  keyboardEntry,
  keyboardEntryState,
  onToggleCollapsed,
}: {
  grid: PianoRollGrid;
  onGridChange: (grid: PianoRollGrid) => void;
  quarterPx: number;
  midiHub: MidiInputHub;
  midi: MidiInputState;
  keyboardEntry: ComputerKeyboardEntry;
  keyboardEntryState: ComputerKeyboardState;
  onToggleCollapsed: () => void;
}) {
  const keyMap = useKeyMapControls();
  const midiMap = useContext(MidiMapContext);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the collapse button is its keyboard equivalent
    <header
      className="fx-device-panel__title"
      onDoubleClick={(event) => {
        if (
          !(event.target as HTMLElement).closest("button") &&
          !isMidiControl(event.target)
        ) {
          onToggleCollapsed();
        }
      }}
    >
      <span className="fx-device-panel__name">Notes</span>
      <PianoRollMidiControls hub={midiHub} state={midi}>
        <PianoRollGridControl
          grid={grid}
          onChange={onGridChange}
          quarterPx={quarterPx}
        />
        <PianoRollKeyboardEntry state={keyboardEntryState} />
        {/* A phone has no top bar for these. */}
        <div className="piano-roll__phone-inputs">
          <KeyInputControl entry={keyboardEntry} map={keyMap} />
          <MidiInputControl hub={midiHub} map={midiMap} />
        </div>
      </PianoRollMidiControls>
      <button
        aria-expanded
        aria-label="Collapse Notes"
        className="fx-device-panel__collapse"
        onClick={onToggleCollapsed}
        title="Collapse Notes"
        type="button"
      >
        <ChevronLeftIcon aria-hidden="true" />
      </button>
    </header>
  );
}
