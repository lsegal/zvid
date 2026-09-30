const MEDIA_SEEK_TOLERANCE_SECONDS = 0.001;
const MEDIA_SEEK_TIMEOUT_MS = 4000;
// HTMLMediaElement.HAVE_CURRENT_DATA, which Node (the unit tests) lacks.
const HAVE_CURRENT_DATA = 2;

// Seeks `element` to `targetSeconds`, resolving once the frame there is
// ready, the seek fails, or it times out.
export function seekMediaElement(
  element: HTMLMediaElement,
  targetSeconds: number,
) {
  const clampedTarget = Math.max(0, targetSeconds);
  const drift = Math.abs(element.currentTime - clampedTarget);
  // A new element sits at 0 before its first frame loads, so being there
  // isn't enough: its frame must be ready too.
  if (
    drift <= MEDIA_SEEK_TOLERANCE_SECONDS &&
    element.readyState >= HAVE_CURRENT_DATA
  ) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      element.removeEventListener("seeked", settle);
      element.removeEventListener("error", settle);
      element.removeEventListener("loadeddata", settle);
      resolve();
    };

    timeoutId = window.setTimeout(settle, MEDIA_SEEK_TIMEOUT_MS);
    element.addEventListener("seeked", settle, { once: true });
    element.addEventListener("error", settle, { once: true });
    element.addEventListener("loadeddata", settle, { once: true });

    try {
      element.pause();
      element.currentTime = clampedTarget;
    } catch {
      settle();
    }
  });
}
