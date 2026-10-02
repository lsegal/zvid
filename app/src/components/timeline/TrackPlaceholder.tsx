import { PlusIcon } from "@heroicons/react/24/solid";
import "./track-placeholder.css";

type TrackAddButtonProps = {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
};

// The [ + Layer ] or [ + Track ] button in a placeholder row's label, which
// adds a row above it. Enter presses it; Space toggles playback.
export function TrackAddButton({
  label,
  title,
  disabled,
  onClick,
}: TrackAddButtonProps) {
  return (
    <button
      className="track-placeholder__add"
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <PlusIcon aria-hidden="true" />
      {label}
    </button>
  );
}
