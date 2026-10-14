import {
  type MidiClipModel,
  PIANO_ROLL_COLLAPSE_KEY,
} from "../../midi-panel-model.ts";
import type { FxCollapseState } from "../fx/FxChain";
import {
  PianoRoll,
  type SetMidiClipNotes,
  type SetMidiClipTimeline,
} from "./PianoRoll";

type MidiDevicesProps = FxCollapseState & {
  midiClip: MidiClipModel | undefined;
  setNotes: SetMidiClipNotes;
  setTimeline: SetMidiClipTimeline;
};

// The FX panel's MIDI devices for the source selection: the selected MIDI
// clip's piano roll. Its Synth and Arpeggiator are effects in its own
// stack (see midi-effects.ts).
export function MidiDevices({
  collapsed,
  toggleCollapsed,
  midiClip,
  setNotes,
  setTimeline,
}: MidiDevicesProps) {
  return midiClip ? (
    <PianoRoll
      collapsed={collapsed.has(PIANO_ROLL_COLLAPSE_KEY)}
      key={midiClip.spanId}
      model={midiClip}
      onSetNotes={setNotes}
      onSetTimeline={setTimeline}
      onToggleCollapsed={() => toggleCollapsed(PIANO_ROLL_COLLAPSE_KEY)}
    />
  ) : null;
}
