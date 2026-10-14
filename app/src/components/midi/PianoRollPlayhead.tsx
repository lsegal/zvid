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
  model: Pick<MidiClipModel, "startQ" | "trimStartQ" | "lengthQ" | "timeline">;
  quarterPx: number;
}) {
  const clock = useContext(FxModulationClockContext);
  const { startQ, trimStartQ, lengthQ, timeline } = model;
  const left = useSyncExternalStore(
    clock?.signal.subscribe ?? noSubscription,
    () => {
      const intoClipQ = (clock?.signal.get() ?? Number.NaN) - startQ;
      return intoClipQ >= 0 && intoClipQ < lengthQ
        ? Math.round(
            midiSoundingQ(timeline, trimStartQ + intoClipQ) * quarterPx,
          )
        : undefined;
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

function noSubscription() {
  return () => {};
}
