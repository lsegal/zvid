import { PlusIcon } from "@heroicons/react/24/solid";
import "./track-placeholder.css";

type TrackAddButtonProps = {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
};

// The [ + Layer ] or [ + Track ] button in a placeholder row's label, which
// adds a row above it. Unlike most controls, Space presses it rather than
// toggling playback.
export function TrackAddButton({
  label,
  title,
  disabled,
  onClick,
}: TrackAddButtonProps) {
  return (
    <button
      className="track-placeholder__add"
      data-space-activates
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
