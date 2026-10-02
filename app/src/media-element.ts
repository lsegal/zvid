// Stops an element and drops its media so the browser can free it.
export function releaseMediaElement(element: HTMLMediaElement) {
  element.pause();
  element.removeAttribute("src");
  element.load();
}

// Calls `onFrame` whenever one of the video elements has a new frame to draw,
// until the returned function removes the listeners.
export function listenForVideoFrames(
  elements: Iterable<HTMLMediaElement>,
  onFrame: () => void,
) {
  const removers: Array<() => void> = [];
  for (const element of elements) {
    if (!(element instanceof HTMLVideoElement)) {
      continue;
    }

    const handleFrameReady = () => onFrame();
    element.addEventListener("seeked", handleFrameReady);
    element.addEventListener("loadeddata", handleFrameReady);
    removers.push(() => {
      element.removeEventListener("seeked", handleFrameReady);
      element.removeEventListener("loadeddata", handleFrameReady);
    });
  }
  return () => {
    for (const remove of removers) {
      remove();
    }
  };
}
