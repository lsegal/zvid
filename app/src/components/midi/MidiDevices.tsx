import { useEffect, useRef } from "react";
import {
  type MidiClipModel,
  PIANO_ROLL_COLLAPSE_KEY,
  SYNTH_COLLAPSE_KEY,
  type SynthTrackModel,
} from "../../midi-panel-model.ts";
import { useSynthDeviceReveal } from "../../synth-device-reveal.ts";
import type { FxCollapseState } from "../fx/FxChain";
import { PianoRoll, type SetMidiClipNotes } from "./PianoRoll";
import { type SetSynthParam, SynthDevice } from "./SynthDevice";

type MidiDevicesProps = FxCollapseState & {
  synthTrack: SynthTrackModel | undefined;
  midiClip: MidiClipModel | undefined;
  setSynthParam: SetSynthParam;
  setNotes: SetMidiClipNotes;
  // Unfolds the FX panel when a track handle's instrument button asks for
  // its Synth device.
  revealPanel: () => void;
};

// The FX panel's MIDI devices for the source selection: the track's Synth
// device, then the selected MIDI clip's piano roll.
export function MidiDevices({
  collapsed,
  toggleCollapsed,
  synthTrack,
  midiClip,
  setSynthParam,
  setNotes,
  revealPanel,
}: MidiDevicesProps) {
  const reveal = useSynthDeviceReveal();
  const handledSerial = useRef(reveal?.serial);
  const synthCollapsed = collapsed.has(SYNTH_COLLAPSE_KEY);
  useEffect(() => {
    if (
      !reveal ||
      reveal.serial === handledSerial.current ||
      reveal.trackId !== synthTrack?.trackId
    ) {
      return;
    }
    handledSerial.current = reveal.serial;
    revealPanel();
    if (synthCollapsed) {
      toggleCollapsed(SYNTH_COLLAPSE_KEY);
    }
  }, [reveal, revealPanel, synthCollapsed, synthTrack, toggleCollapsed]);

  return (
    <>
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
