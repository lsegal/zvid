import { useContext, useSyncExternalStore } from "react";
import { midiSoundingQ } from "../../midi-clip-timeline.ts";
import type { MidiClipModel } from "../../midi-panel-model.ts";
import { FxModulationClockContext } from "../fx/modulation-clock";

// The transport playhead on the piano roll's grid, read-only: a line at
// the note the clip is sounding, through its Start marker and loop (see
// midi-clip-timeline.ts), hidden while the playhead is outside the clip.
// It follows the playhead signal on its own, so playback moves it every
// frame without re-rendering the roll.
export function PianoRollPlayhead({
  model,
  quarterPx,
}: {
  model: PlayheadModel;
  quarterPx: number;
}) {
  const clock = useContext(FxModulationClockContext);
  const left = useSyncExternalStore(
    clock?.signal.subscribe ?? noSubscription,
    () => {
      const soundingQ = pianoRollPlayheadQ(
        model,
        clock?.signal.get() ?? Number.NaN,
      );
      return soundingQ === undefined
        ? undefined
        : Math.round(soundingQ * quarterPx);
    },
  );
  return left === undefined ? null : (
    <div
      aria-hidden="true"
      className="piano-roll__playhead"
      data-piano-roll-playhead
      style={{ transform: `translateX(${left}px) translateX(-50%)` }}
    />
  );
}

type PlayheadModel = Pick<
  MidiClipModel,
  "startQ" | "trimStartQ" | "lengthQ" | "timeline"
>;

/**
 * The note quarter (from the clip's content start) the clip sounds at
 * timeline quarter `playheadQ`, or undefined outside the clip.
 */
export function pianoRollPlayheadQ(
  { startQ, trimStartQ, lengthQ, timeline }: PlayheadModel,
  playheadQ: number,
) {
  const intoClipQ = playheadQ - startQ;
  return intoClipQ >= 0 && intoClipQ < lengthQ
    ? midiSoundingQ(timeline, trimStartQ + intoClipQ)
    : undefined;
}

function noSubscription() {
  return () => {};
}
