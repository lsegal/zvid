import { useSyncExternalStore } from "react";
import { quartersToSeconds } from "../composition-active-clips.ts";
import type { PlayheadSignal } from "../playhead-signal";
import {
  formatMusicalPosition,
  formatTimecode,
  type MeterSignature,
} from "../timeline-format.ts";

// These pieces follow the playhead signal on their own, so playback moves them
// every frame without re-rendering the app around them.

export function PlayheadLine({
  signal,
  quarterPx,
  offsetPx,
  className,
}: {
  signal: PlayheadSignal;
  quarterPx: number;
  offsetPx: number;
  className: string;
}) {
  const left = useSyncExternalStore(
    signal.subscribe,
    () => offsetPx + Math.round(signal.get() * quarterPx),
  );
  // Moved with a transform on its own layer: changing `left` every frame
  // makes WebKit repaint the timeline under the line, which halved the frame
  // rate of playback in Safari.
  return (
    <div
      className={className}
      style={{ transform: `translateX(${left}px) translateX(-50%)` }}
    />
  );
}

// Clicking either readout swaps the timeline between bars and timecode.
export function TransportPlayheadReadout({
  signal,
  bpm,
  fps,
  signature,
  onSwapTimeMode,
}: {
  signal: PlayheadSignal;
  bpm: number;
  fps: number;
  signature: MeterSignature;
  onSwapTimeMode: () => void;
}) {
  const timecode = useSyncExternalStore(signal.subscribe, () =>
    formatTimecode(quartersToSeconds(signal.get(), bpm), fps),
  );
  const position = useSyncExternalStore(signal.subscribe, () =>
    formatMusicalPosition(signal.get(), signature),
  );
  return (
    <button
      aria-label="Swap time mode"
      className="timeline-toolbar__readout"
      onClick={onSwapTimeMode}
      title="Swap time mode"
      type="button"
    >
      <span>{timecode}</span>
      <strong>{position}</strong>
    </button>
  );
}
