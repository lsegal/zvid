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
  return <div className={className} style={{ left }} />;
}

export function TransportPlayheadReadout({
  signal,
  bpm,
  fps,
  signature,
}: {
  signal: PlayheadSignal;
  bpm: number;
  fps: number;
  signature: MeterSignature;
}) {
  const timecode = useSyncExternalStore(signal.subscribe, () =>
    formatTimecode(quartersToSeconds(signal.get(), bpm), fps),
  );
  const position = useSyncExternalStore(signal.subscribe, () =>
    formatMusicalPosition(signal.get(), signature),
  );
  return (
    <>
      <span>{timecode}</span>
      <strong>{position}</strong>
    </>
  );
}
