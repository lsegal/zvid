import { useCallback, useEffect, useRef } from "react";
import { createMeterTap, type MasterMeterTap } from "../fx-shaders/audio-bands";
import { analysisAudioContext } from "../recording/shared-audio-context.ts";

type CapturableElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
};

type ElementTap = {
  element: HTMLMediaElement;
  trackId: string;
  source: MediaStreamAudioSourceNode;
  tap: MasterMeterTap;
};

// A meter tap on the Media tab's player, for the audio analysis pane. It
// listens to a captured copy of the element's audio, so playback itself is
// never rerouted through Web Audio; where the browser can't capture a media
// element, the getter returns null and the pane stays idle. Returns a ref
// callback for the element and a stable getter for its tap.
export function useMediaElementMeterTap() {
  const elementRef = useRef<HTMLMediaElement | null>(null);
  // One capture per element: each captureStream() call makes new tracks.
  const streamRef = useRef<MediaStream | null>(null);
  const tapRef = useRef<ElementTap | null>(null);

  const release = useCallback(() => {
    if (tapRef.current) {
      tapRef.current.source.disconnect();
      tapRef.current = null;
      analysisAudioContext.release();
    }
  }, []);

  useEffect(() => release, [release]);

  const setElement = useCallback(
    (element: HTMLMediaElement | null) => {
      if (element !== elementRef.current) {
        streamRef.current = null;
      }
      elementRef.current = element;
      if (tapRef.current && tapRef.current.element !== element) {
        release();
      }
    },
    [release],
  );

  const getMeterTap = useCallback((): MasterMeterTap | null => {
    const element = elementRef.current as CapturableElement | null;
    if (!element || typeof element.captureStream !== "function") {
      return null;
    }
    const current = tapRef.current;
    try {
      streamRef.current ??= element.captureStream();
    } catch {
      return null;
    }
    // The audio track appears once the element has loaded its media.
    const [track] = streamRef.current.getAudioTracks();
    if (!track) {
      return null;
    }
    if (current?.element === element && current.trackId === track.id) {
      return current.tap;
    }
    release();
    const context = analysisAudioContext.acquire();
    const { input, tap } = createMeterTap(context);
    const source = context.createMediaStreamSource(new MediaStream([track]));
    source.connect(input);
    tapRef.current = { element, trackId: track.id, source, tap };
    return tap;
  }, [release]);

  return { setElement, getMeterTap };
}
