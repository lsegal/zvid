// How far into the timeline from its left edge a drag springs the Media
// drawer open.
export const MEDIA_DRAWER_SPRING_EDGE_PX = 24;

type Rect = Pick<DOMRect, "left" | "top" | "bottom">;

function closestElement(target: EventTarget | null, selector: string) {
  return target && typeof (target as Element).closest === "function"
    ? (target as Element).closest(selector)
    : null;
}

// The Media tab's list, which takes dropped media files into the session.
export function isMediaBinDropTarget(target: EventTarget | null) {
  return !!closestElement(target, "[data-media-bin-drop-target]");
}

// A drag over the drawer, or left of the timeline where the closed drawer
// sits, opens the Media tab to drop on.
export function isMediaDrawerSpringTarget(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  timelineRect: Rect | undefined,
) {
  if (closestElement(target, ".media-drawer-column")) {
    return true;
  }
  return (
    !!timelineRect &&
    clientX < timelineRect.left + MEDIA_DRAWER_SPRING_EDGE_PX &&
    clientY >= timelineRect.top &&
    clientY <= timelineRect.bottom
  );
}
