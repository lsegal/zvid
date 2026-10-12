import { useEffect, useRef, useState } from "react";
import { secondsToQuarters } from "../app/timeline-math.ts";
import type { ExportRange } from "../export-options.ts";
import {
  createPlayheadSignal,
  PLAYBACK_COMMIT_INTERVAL_MS,
} from "../playhead-signal";

// The dialog's own transport: plays the composite from In to Out, looping
// back to In when looping is on, without touching the editor's playhead.
export function useRangePlayback(range: ExportRange, bpm: number) {
  const [signal] = useState(() => createPlayheadSignal(range.inQ));
  const [playheadQ, setPlayheadQState] = useState(range.inQ);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  // Set by a seek during playback so the clock restarts from there.
  const seekedRef = useRef(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    let frame = 0;
    let originQ = signal.get();
    let startedAt = performance.now();
    let committedAt = startedAt;
    const step = (timestamp: number) => {
      const { inQ, outQ } = rangeRef.current;
      if (seekedRef.current) {
        seekedRef.current = false;
        originQ = signal.get();
        startedAt = timestamp;
      }
      const nextQ =
        originQ + secondsToQuarters((timestamp - startedAt) / 1000, bpm);
      if (nextQ >= outQ) {
        if (!loopRef.current) {
          signal.set(outQ);
          setPlayheadQState(outQ);
          setIsPlaying(false);
          return;
        }
        originQ = inQ;
        startedAt = timestamp;
        committedAt = timestamp;
        signal.set(inQ);
        setPlayheadQState(inQ);
      } else {
        signal.set(nextQ);
        if (timestamp - committedAt >= PLAYBACK_COMMIT_INTERVAL_MS) {
          setPlayheadQState(nextQ);
          committedAt = timestamp;
        }
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frame);
      setPlayheadQState(signal.get());
    };
  }, [bpm, isPlaying, signal]);

  function seek(q: number) {
    signal.set(q);
    setPlayheadQState(q);
    seekedRef.current = isPlaying;
  }

  function play() {
    const { inQ, outQ } = rangeRef.current;
    const q = signal.get();
    if (q < inQ || q >= outQ - 1e-6) {
      seek(inQ);
    }
    setIsPlaying(true);
  }

  function toggle() {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      play();
    }
  }

  return {
    signal,
    playheadQ,
    isPlaying,
    setIsPlaying,
    loop,
    setLoop,
    seek,
    toggle,
  };
}
