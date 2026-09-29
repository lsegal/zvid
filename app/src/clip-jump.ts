// Ctrl-clicking an arrangement clip (Cmd-clicking on macOS) selects it and
// jumps the playhead to its start. Ctrl-click on macOS is a right-click and
// opens the clip menu instead, and source clips keep Ctrl/Cmd-click for
// dropping onto the arrangement.

/** The jump-to-start hint for the clip tooltip and menu. */
export function formatClipJumpShortcut(mac: boolean) {
  return mac ? "Cmd+click" : "Ctrl+click";
}

/** Whether a press on an arrangement clip jumps the playhead to its start. */
export function isClipJumpPress(
  event: { button: number; ctrlKey: boolean; metaKey: boolean },
  mac: boolean,
) {
  return event.button === 0 && (mac ? event.metaKey : event.ctrlKey);
}

/**
 * The timeline scroll position that shows `targetPx` (in scroll content
 * pixels), or `scrollLeft` when it is already visible. The track labels
 * cover the first `labelWidth` pixels of the viewport, and a revealed target
 * sits `marginRatio` of the visible lane width past them.
 */
export function revealScrollLeft({
  targetPx,
  scrollLeft,
  viewportWidth,
  labelWidth,
  maxScrollLeft,
  marginRatio = 0.1,
}: {
  targetPx: number;
  scrollLeft: number;
  viewportWidth: number;
  labelWidth: number;
  maxScrollLeft: number;
  marginRatio?: number;
}) {
  if (
    targetPx >= scrollLeft + labelWidth &&
    targetPx <= scrollLeft + viewportWidth
  ) {
    return scrollLeft;
  }

  const marginPx = Math.max(0, viewportWidth - labelWidth) * marginRatio;
  return Math.min(
    Math.max(0, targetPx - labelWidth - marginPx),
    Math.max(0, maxScrollLeft),
  );
}
