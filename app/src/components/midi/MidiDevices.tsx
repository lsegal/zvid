import {
  ARPEGGIATOR_COLLAPSE_KEY,
  type MidiClipModel,
  PIANO_ROLL_COLLAPSE_KEY,
  SYNTH_COLLAPSE_KEY,
  type SynthTrackModel,
} from "../../midi-panel-model.ts";
import type { FxCollapseState } from "../fx/FxChain";
import { ArpeggiatorDevice, type SetArpeggiator } from "./ArpeggiatorDevice";
import { PianoRoll, type SetMidiClipNotes } from "./PianoRoll";
import { type SetSynthParam, SynthDevice } from "./SynthDevice";

type MidiDevicesProps = FxCollapseState & {
  synthTrack: SynthTrackModel | undefined;
  midiClip: MidiClipModel | undefined;
  setSynthParam: SetSynthParam;
  setArpeggiator: SetArpeggiator;
  setNotes: SetMidiClipNotes;
};

// The FX panel's MIDI devices for the source selection: the track's Synth
// device, led by its Arpeggiator, then the selected MIDI clip's piano roll.
export function MidiDevices({
  collapsed,
  toggleCollapsed,
  synthTrack,
  midiClip,
  setSynthParam,
  setArpeggiator,
  setNotes,
}: MidiDevicesProps) {
  return (
    <>
      {synthTrack ? (
        <ArpeggiatorDevice
          collapsed={collapsed.has(ARPEGGIATOR_COLLAPSE_KEY)}
          key={`arp-${synthTrack.trackId}`}
          model={synthTrack}
          onSet={setArpeggiator}
          onToggleCollapsed={() => toggleCollapsed(ARPEGGIATOR_COLLAPSE_KEY)}
        />
      ) : null}
      {synthTrack ? (
        <SynthDevice
          collapsed={synthCollapsed}
          key={synthTrack.trackId}
          model={synthTrack}
          onSetParam={setSynthParam}
          onToggleCollapsed={() => toggleCollapsed(SYNTH_COLLAPSE_KEY)}
        />
      ) : null}
      {midiClip ? (
        <PianoRoll
          collapsed={collapsed.has(PIANO_ROLL_COLLAPSE_KEY)}
          key={midiClip.spanId}
          model={midiClip}
          onSetNotes={setNotes}
          onToggleCollapsed={() => toggleCollapsed(PIANO_ROLL_COLLAPSE_KEY)}
        />
      ) : null}
    </>
  );
}
