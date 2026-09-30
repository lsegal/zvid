import { WandIcon } from "./WandIcon";
import "./arrangement-empty-state.css";

// Floating call to action over an empty arrangement. Only the two buttons take
// pointer events, so drag-to-create still works on the lanes underneath.
export function ArrangementEmptyState({
  disabled,
  onDismiss,
  onGenerate,
  top,
  visibleHeight,
  visibleWidth,
}: {
  disabled?: boolean;
  onDismiss: () => void;
  onGenerate: () => void;
  // Offset below the sticky ruler, and the scroll viewport's size beside the
  // track labels and below the ruler.
  top: number;
  visibleHeight: number;
  visibleWidth: number;
}) {
  return (
    <div className="arrangement-empty-state">
      <div
        className="arrangement-empty-state__viewport"
        style={{
          top,
          width: visibleWidth > 0 ? visibleWidth : undefined,
          maxHeight: visibleHeight > 0 ? visibleHeight : undefined,
        }}
      >
        <button
          className="arrangement-empty-state__generate"
          disabled={disabled}
          onClick={onGenerate}
          type="button"
        >
          <WandIcon />
          <span>Generate a sweet timeline</span>
        </button>
        <button
          aria-label="Dismiss"
          className="arrangement-empty-state__dismiss"
          onClick={onDismiss}
          title="Dismiss"
          type="button"
        >
          <span aria-hidden="true">✕</span>
          <span>or dismiss</span>
        </button>
      </div>
    </div>
  );
}
