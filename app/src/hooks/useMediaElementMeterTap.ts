import { useCallback, useEffect, useRef } from "react";
import { createMeterTap, type MasterMeterTap } from "../fx-shaders/audio-bands";
import { analysisAudioContext } from "../recording/shared-audio-context.ts";
import { MediaAnalysisMirror } from "./media-analysis-mirror.ts";

type CapturableElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
};

type ElementTap = {
  element: HTMLMediaElement;
  // The captured track it listens to, or the hidden copy it follows.
  trackId: string | null;
  mirror: MediaAnalysisMirror | null;
  source: AudioNode;
  tap: MasterMeterTap;
};

// A meter tap on the Media tab's player, for the audio analysis pane. It
// listens to a captured copy of the element's audio, so playback itself is
// never rerouted through Web Audio. Where the browser can't capture a media
// element (WebKit, Firefox), it listens to a hidden copy of the element that
// follows its playback instead (see MediaAnalysisMirror), unless
// `canMirror` is false, and then the getter returns null and the pane stays
// idle. The tap and any copy are released once `active` is false. Returns a
// ref callback for the element and a stable getter for its tap.
export function useMediaElementMeterTap({
  active,
  canMirror,
}: {
  active: boolean;
  canMirror: boolean;
}) {
  const elementRef = useRef<HTMLMediaElement | null>(null);
  // One capture per element: each captureStream() call makes new tracks.
  const streamRef = useRef<MediaStream | null>(null);
  const tapRef = useRef<ElementTap | null>(null);

  const canMirrorRef = useRef(canMirror);
  canMirrorRef.current = canMirror;

  const release = useCallback(() => {
    if (tapRef.current) {
      tapRef.current.source.disconnect();
      tapRef.current.mirror?.dispose();
      tapRef.current = null;
      analysisAudioContext.release();
    }
  }, []);

  useEffect(() => release, [release]);

  useEffect(() => {
    if (!active) {
      release();
    }
  }, [active, release]);

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

  const getMirrorTap = useCallback(
    (element: HTMLMediaElement): MasterMeterTap | null => {
      if (!canMirrorRef.current) {
        return null;
      }
      const current = tapRef.current;
      if (current?.element === element && current.mirror) {
        return current.tap;
      }
      release();
      const context = analysisAudioContext.acquire();
      const { input, tap } = createMeterTap(context);
      // Routed before it loads anything.
      const copy = new Audio();
      const source = context.createMediaElementSource(copy);
      source.connect(input);
      const mirror = new MediaAnalysisMirror(element, copy);
      tapRef.current = { element, trackId: null, mirror, source, tap };
      return tap;
    },
    [release],
  );

  const getMeterTap = useCallback((): MasterMeterTap | null => {
    const element = elementRef.current as CapturableElement | null;
    if (!element) {
      return null;
    }
    if (typeof element.captureStream !== "function") {
      return getMirrorTap(element);
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
    tapRef.current = { element, trackId: track.id, mirror: null, source, tap };
    return tap;
  }, [getMirrorTap, release]);

  return { setElement, getMeterTap };
}
