// The timeline cancels the browser's default for its presses, so dragging
// never selects text. That also cancels the focus change a click makes, so a
// zoom slider, knob or text field focused before the press kept the focus and
// took every shortcut key, Space included, away from the timeline (#926).

type FocusTarget = {
  closest?: (selector: string) => unknown;
};

type FocusedElement = {
  contains?: (other: unknown) => boolean;
};

const TIMELINE_PANEL_SELECTOR = ".timeline-panel";

// Whether a press on `target` should take the focus off `active`, as a click
// anywhere else on the page would. A press inside the focused element, such
// as in a text field it holds, keeps it.
export function shouldReleaseFocus(
  target: unknown,
  active: unknown,
  body: unknown,
) {
  if (!active || active === body) {
    return false;
  }

  const element = target as FocusTarget | null;
  if (
    typeof element?.closest !== "function" ||
    !element.closest(TIMELINE_PANEL_SELECTOR)
  ) {
    return false;
  }

  const focused = active as FocusedElement;
  return !focused.contains?.(target);
}
