import type { PreviewVolume } from "./app/preview-volume.ts";
import type { LiveAudioBands } from "./fx-shaders/audio-bands.ts";

// Stops an element and drops its media so the browser can free it.
export function releaseMediaElement(element: HTMLMediaElement) {
  element.pause();
  element.removeAttribute("src");
  element.load();
}

// Sets how loud the preview plays an element. An element routed through Web
// Audio is turned down after the analyser instead, and itself stays at full
// volume, since some browsers feed a quieter element to the analyser too and
// audio-reactive effects would follow the volume slider.
export function applyPreviewVolume(
  element: HTMLMediaElement | null,
  { volume, muted }: PreviewVolume,
  bands?: LiveAudioBands | null,
) {
  if (!element) {
    return;
  }
  if (bands?.setOutputGain(element, muted ? 0 : volume)) {
    element.volume = 1;
    element.muted = false;
    return;
  }
  element.volume = volume;
  element.muted = muted;
}

// Source clips' audio plays at the preview volume; video elements stay muted
// since their sound comes from the main audio.
export function applyPreviewVolumes(
  elements: Iterable<HTMLMediaElement>,
  volume: PreviewVolume,
) {
  for (const element of elements) {
    if (!(element instanceof HTMLVideoElement)) {
      applyPreviewVolume(element, volume);
    }
  }
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
