import { useEffect } from "react";
import { CHAIN_WORKLET_URL } from "../../audio-mix/chain-worklet-url.ts";
import { setAuditionWorkletUrl } from "../../midi-audition.ts";
import type { MidiNote } from "../../midi-clip.ts";
import { newMidiTimeline } from "../../midi-clip-timeline.ts";
import { computerKeyboardEntry } from "../../midi-input/computer-keyboard.ts";
import { midiInputHub } from "../../midi-input/input-hub.ts";
import type { PlayheadSignal } from "../../playhead-signal.ts";
import {
  type ArmedAuditionSession,
  auditionTracks,
  keyTrackIds,
  setArmedAuditionSource,
  trackInstruments,
  useRollKeysClaimed,
} from "../../recording/armed-audition.ts";
import { useArmedTrackIds } from "../../recording/record-arm.ts";
import { useMidiPassActive } from "../../recording/record-source.ts";
import { useComputerKeyboardEntry } from "../midi/use-computer-keyboard-entry";
import { useMidiNoteCapture } from "../midi/use-midi-note-capture";

// With no clock there is nothing to write notes against.
const NO_CLIP = {
  startQ: 0,
  trimStartQ: 0,
  lengthQ: 0,
  timeline: newMidiTimeline(0),
};
const ignoreCapture = (_note: MidiNote) => {};

// Plays keys through the armed tracks, or with none armed the selected track,
// while no piano roll or MIDI pass has them, which then do it themselves. The
// typing keyboard only takes its keys from the shortcuts when one of those
// tracks has something to play.
export function ArmedTrackAudition({
  session,
  playheadSignal,
  selectedTrackId,
}: {
  session: ArmedAuditionSession;
  playheadSignal: PlayheadSignal;
  selectedTrackId?: string;
}) {
  useEffect(() => {
    setAuditionWorkletUrl(CHAIN_WORKLET_URL);
    setArmedAuditionSource(session, () => playheadSignal.get());
  }, [session, playheadSignal]);
  const trackIds = keyTrackIds(useArmedTrackIds(), selectedTrackId);
  const midiPassActive = useMidiPassActive();
  const rollKeysClaimed = useRollKeysClaimed();
  const enabled =
    !midiPassActive &&
    !rollKeysClaimed &&
    trackInstruments(trackIds, session).length > 0;
  const { playKey, releaseKey } = useMidiNoteCapture({
    enabled,
    hub: midiInputHub,
    clip: NO_CLIP,
    clock: null,
    onAudition: (pitch, expression) =>
      auditionTracks(trackIds, pitch, expression),
    onCapture: ignoreCapture,
  });
  useComputerKeyboardEntry({
    active: enabled,
    entry: computerKeyboardEntry,
    press: playKey,
    release: releaseKey,
  });
  return null;
}
