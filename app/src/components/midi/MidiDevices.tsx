import { useEffect, useRef } from "react";
import {
  ARPEGGIATOR_COLLAPSE_KEY,
  type MidiClipModel,
  PIANO_ROLL_COLLAPSE_KEY,
  SYNTH_COLLAPSE_KEY,
  type SynthTrackModel,
} from "../../midi-panel-model.ts";
import { useSynthDeviceReveal } from "../../synth-device-reveal.ts";
import type { FxCollapseState } from "../fx/FxChain";
import { ArpeggiatorDevice, type SetArpeggiator } from "./ArpeggiatorDevice";
import {
  PianoRoll,
  type SetMidiClipNotes,
  type SetMidiClipTimeline,
} from "./PianoRoll";
import { type SetSynthParam, SynthDevice } from "./SynthDevice";

type MidiDevicesProps = FxCollapseState & {
  synthTrack: SynthTrackModel | undefined;
  midiClip: MidiClipModel | undefined;
  setSynthParam: SetSynthParam;
  setArpeggiator: SetArpeggiator;
  setNotes: SetMidiClipNotes;
  setTimeline: SetMidiClipTimeline;
  // Unfolds the FX panel when a track handle's instrument button asks for
  // its Synth device.
  revealPanel: () => void;
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
  setTimeline,
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
          onSetTimeline={setTimeline}
          onToggleCollapsed={() => toggleCollapsed(PIANO_ROLL_COLLAPSE_KEY)}
        />
      ) : null}
    </>
  );
}
