import type { PointerEvent as ReactPointerEvent } from "react";
import type { TimelineSelection } from "../../app/types.ts";
import type { SelectionEditKind } from "../../lane-selection-gesture.ts";
import { selectionHint } from "../../selection-hint.ts";
import "./selection-overlay.css";

type SelectionOverlayProps = {
  selection: TimelineSelection;
  quarterPx: number;
  // A press on the body (to move it) or on an edge handle (to resize it).
  onEditPress: (
    event: ReactPointerEvent<HTMLElement>,
    edit: SelectionEditKind,
  ) => void;
};

// A layer's range selection box, with the hint that fits inside it. Its body
// drags to move it and its edge handles drag to resize it.
export function SelectionOverlay({
  selection,
  quarterPx,
  onEditPress,
}: SelectionOverlayProps) {
  const width = selection.durationQ * quarterPx;
  const hint = selectionHint(width);
  return (
    <div
      className="timeline-selection"
      onPointerDown={(event) => onEditPress(event, "move")}
      style={{
        left: selection.startQ * quarterPx,
        width,
        paddingInline: hint.paddingPx,
      }}
    >
      <button
        aria-label="Resize selection start"
        className="timeline-selection__handle timeline-selection__handle--start"
        onPointerDown={(event) => onEditPress(event, "resize-start")}
        tabIndex={-1}
        type="button"
      />
      {hint.label ? <span>{hint.label}</span> : null}
      <button
        aria-label="Resize selection end"
        className="timeline-selection__handle timeline-selection__handle--end"
        onPointerDown={(event) => onEditPress(event, "resize-end")}
        tabIndex={-1}
        type="button"
      />
    </div>
  );
}
