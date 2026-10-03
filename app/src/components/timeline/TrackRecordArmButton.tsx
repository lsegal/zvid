import { toggleTrackArmed, useTrackArmed } from "../../recording/record-arm.ts";
import "./track-record-arm-button.css";

type TrackRecordArmButtonProps = {
  // The source track the button arms.
  track: { id: string; name: string };
};

// A source track's record arm button, right of its FX switch: a red dot,
// filled and lit while the track is armed and outlined and dim while not.
// Armed tracks record whenever recording starts. The label click handlers
// leave it out, so clicking it never selects the track.
export function TrackRecordArmButton({ track }: TrackRecordArmButtonProps) {
  const armed = useTrackArmed(track.id);
  const label = armed
    ? `Disarm ${track.name}`
    : `Arm ${track.name} for recording`;
  return (
    <button
      aria-label={label}
      aria-pressed={armed}
      className="track-label__arm"
      onClick={(event) => {
        event.stopPropagation();
        toggleTrackArmed(track.id);
      }}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className="track-label__arm-dot" />
    </button>
  );
}
