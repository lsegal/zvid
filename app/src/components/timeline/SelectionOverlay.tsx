import type { TimelineSelection } from "../../app/types.ts";
import { selectionHint } from "../../selection-hint.ts";

type SelectionOverlayProps = {
  selection: TimelineSelection;
  quarterPx: number;
};

// A layer's range selection box, with the hint that fits inside it.
export function SelectionOverlay({
  selection,
  quarterPx,
}: SelectionOverlayProps) {
  const width = selection.durationQ * quarterPx;
  const hint = selectionHint(width);
  return (
    <div
      className="timeline-selection"
      style={{
        left: selection.startQ * quarterPx,
        width,
        paddingInline: hint.paddingPx,
      }}
    >
      {hint.label ? <span>{hint.label}</span> : null}
    </div>
  );
}
