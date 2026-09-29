import { WandIcon } from "./WandIcon";

// Floating call to action over an empty arrangement. Only the two buttons take
// pointer events, so drag-to-create still works on the lanes underneath.
export function ArrangementEmptyState({
  disabled,
  onDismiss,
  onGenerate,
  visibleWidth,
}: {
  disabled?: boolean;
  onDismiss: () => void;
  onGenerate: () => void;
  visibleWidth: number;
}) {
  return (
    <div className="arrangement-empty-state">
      <div
        className="arrangement-empty-state__viewport"
        style={visibleWidth > 0 ? { width: visibleWidth } : undefined}
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
          ×
        </button>
      </div>
    </div>
  );
}
