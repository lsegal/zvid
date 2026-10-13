import { MusicalNoteIcon } from "@heroicons/react/24/solid";
import { revealSynthDevice } from "../../synth-device-reveal.ts";
import "./track-instrument-button.css";

type TrackInstrumentButtonProps = {
  // The source track whose MIDI clips play through the synth.
  track: { id: string; name: string };
};

// A source track's instrument slot, shown while it has MIDI clips: it opens
// the track's Synth device in the FX panel. The click also reaches the
// label, which selects the track, so the panel shows that track.
export function TrackInstrumentButton({ track }: TrackInstrumentButtonProps) {
  const label = `Open ${track.name} synth`;
  return (
    <button
      aria-label={label}
      className="track-label__instrument"
      onClick={() => revealSynthDevice(track.id)}
      title={label}
      type="button"
    >
      <MusicalNoteIcon aria-hidden="true" />
    </button>
  );
}
