import { useSyncExternalStore } from "react";
import type { PlayheadSignal } from "../playhead-signal";
import {
  buildPlayheadStatusItem,
  formatStatusPlayhead,
  type StatusPlayheadState,
} from "../status-items";

// Live playhead readout for the status bar. It subscribes to the playhead
// directly and re-renders only when the formatted value changes, so playback
// never re-renders the rest of the status bar.
export function StatusPlayhead({
  signal,
  ...ruler
}: Omit<StatusPlayheadState, "playheadQ"> & { signal: PlayheadSignal }) {
  useSyncExternalStore(signal.subscribe, () =>
    formatStatusPlayhead({ ...ruler, playheadQ: signal.get() }),
  );
  const { value, title } = buildPlayheadStatusItem({
    ...ruler,
    playheadQ: signal.get(),
  });
  return <span title={title}>{value}</span>;
}
