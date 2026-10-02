import { isLayerFxEnabled } from "../../fx-stack";
import "./track-fx-button.css";

type TrackFxButtonProps = {
  // The layer or source track the switch belongs to.
  track: { id: string; name: string; fxEnabled?: boolean };
  setFxEnabled: (enabled: boolean) => void;
};

// A layer's or source track's FX switch, lit while its FX are on. The label
// click handlers leave it out, so clicking it never selects the track.
export function TrackFxButton({ track, setFxEnabled }: TrackFxButtonProps) {
  const fxEnabled = isLayerFxEnabled(track);
  return (
    <button
      aria-label={`${track.name} effects`}
      aria-pressed={fxEnabled}
      className="track-label__fx track-label__fx--switch"
      onClick={(event) => {
        event.stopPropagation();
        setFxEnabled(!fxEnabled);
      }}
      title={`Turn ${track.name} FX ${fxEnabled ? "off" : "on"}`}
      type="button"
    >
      fx
    </button>
  );
}
