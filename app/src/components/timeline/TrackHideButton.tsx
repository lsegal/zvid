import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/solid";
import { isTrackHidden } from "../../track-visibility.ts";
import "./track-hide-button.css";

type TrackHideButtonProps = {
  // The layer or source track the switch belongs to.
  track: { id: string; name: string; hidden?: boolean };
  setHidden: (hidden: boolean) => void;
};

// A layer's or source track's Hide switch: a dimmed eye while it is shown,
// and a lit eye-slash while it is hidden. The label click handlers leave it
// out, so clicking it never selects the track.
export function TrackHideButton({ track, setHidden }: TrackHideButtonProps) {
  const hidden = isTrackHidden(track);
  const Icon = hidden ? EyeSlashIcon : EyeIcon;
  return (
    <button
      aria-label={`Hide ${track.name}`}
      aria-pressed={hidden}
      className="track-label__hide"
      onClick={(event) => {
        event.stopPropagation();
        setHidden(!hidden);
      }}
      title={`${hidden ? "Show" : "Hide"} ${track.name}`}
      type="button"
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
