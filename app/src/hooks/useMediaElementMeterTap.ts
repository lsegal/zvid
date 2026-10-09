import { useCallback, useEffect, useRef } from "react";
import { createMeterTap, type MasterMeterTap } from "../fx-shaders/audio-bands";
import { analysisAudioContext } from "../recording/shared-audio-context.ts";
import { MediaAnalysisDecodedFollower } from "./media-analysis-decoded.ts";
import {
  type MediaAnalysisFallback,
  MediaAnalysisMirror,
} from "./media-analysis-mirror.ts";

type CapturableElement = HTMLMediaElement & {
  captureStream?: () => MediaStream;
};

type ElementTap = {
  element: HTMLMediaElement;
  // The captured track it listens to, or the copy it follows and how.
  trackId: string | null;
  follower: { dispose(): void } | null;
  fallback: MediaAnalysisFallback;
  source: AudioNode;
  tap: MasterMeterTap;
};

// A meter tap on the Media tab's player, for the audio analysis pane. It
// listens to a captured copy of the element's audio, so playback itself is
// never rerouted through Web Audio. Where the browser can't capture a media
// element (WebKit, Firefox), it listens to a copy that follows the element's
// playback instead, as `fallback` says: a hidden copy of the element (see
// MediaAnalysisMirror) or a decoded copy of its audio (see
// MediaAnalysisDecodedFollower). Without one the getter returns null and the
// pane stays idle. The tap and any copy are released once `active` is false. Returns a
// ref callback for the element and a stable getter for its tap.
export function useMediaElementMeterTap({
  active,
  fallback,
}: {
  active: boolean;
  fallback: MediaAnalysisFallback;
}) {
  const elementRef = useRef<HTMLMediaElement | null>(null);
  // One capture per element: each captureStream() call makes new tracks.
  const streamRef = useRef<MediaStream | null>(null);
  const tapRef = useRef<ElementTap | null>(null);

  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const release = useCallback(() => {
    if (tapRef.current) {
      tapRef.current.source.disconnect();
      tapRef.current.follower?.dispose();
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

  const getFollowerTap = useCallback(
    (element: HTMLMediaElement): MasterMeterTap | null => {
      const fallback = fallbackRef.current;
      if (!fallback) {
        release();
        return null;
      }
      const current = tapRef.current;
      if (current?.element === element && current.fallback === fallback) {
        return current.tap;
      }
      release();
      const context = analysisAudioContext.acquire();
      const { input, tap } = createMeterTap(context);
      if (fallback === "decode") {
        const follower = new MediaAnalysisDecodedFollower(
          element,
          context,
          input,
          async (url) => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Cannot read media (${response.status}).`);
            }
            return context.decodeAudioData(await response.arrayBuffer());
          },
        );
        const source = input;
        tapRef.current = {
          element,
          trackId: null,
          follower,
          fallback,
          source,
          tap,
        };
        return tap;
      }
      // Routed before it loads anything.
      const copy = new Audio();
      const source = context.createMediaElementSource(copy);
      source.connect(input);
      const follower = new MediaAnalysisMirror(element, copy);
      tapRef.current = {
        element,
        trackId: null,
        follower,
        fallback,
        source,
        tap,
      };
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
      return getFollowerTap(element);
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
    tapRef.current = {
      element,
      trackId: track.id,
      follower: null,
      fallback: null,
      source,
      tap,
    };
    return tap;
  }, [getFollowerTap, release]);

  return { setElement, getMeterTap };
}
