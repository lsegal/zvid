import "./source-empty-state.css";

type SourceEmptyStateProps = {
  onImport: () => void;
  onOpenSession: () => void;
  onOpenSample: () => void;
};

// The source tracks' call to action while the project has no source media.
export function SourceEmptyState({
  onImport,
  onOpenSession,
  onOpenSample,
}: SourceEmptyStateProps) {
  return (
    <div className="source-empty-state">
      <span>No source media yet</span>
      <button
        className="ghost-button ghost-button--accent"
        onClick={onImport}
        type="button"
      >
        Import Media
      </button>
      <button
        className="ghost-button"
        onClick={onOpenSession}
        title="Open a .zvd or .lvp session or an Ableton .als set"
        type="button"
      >
        Open Session
      </button>
      <button
        className="ghost-button"
        onClick={onOpenSample}
        title="Open an editable copy of the zvid opening sample"
        type="button"
      >
        Open Sample
      </button>
    </div>
  );
}
