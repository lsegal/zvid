import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { clamp } from "../app/util.ts";

const BPM_STEP = 5;
const BPM_MIN = 60;
const BPM_MAX = 220;

// The top bar's tempo readout, with buttons that step it by 5 BPM.
export function TempoPill({
  bpm,
  commitProjectChange,
}: {
  bpm: number;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
}) {
  const adjust = (delta: number) =>
    commitProjectChange("Adjust BPM", (current) =>
      patchProjectState(current, {
        bpm: clamp(current.bpm + delta, BPM_MIN, BPM_MAX),
      }),
    );
  return (
    <div className="tempo-pill">
      <button
        aria-label="Decrease tempo"
        className="tempo-pill__adjust"
        onClick={() => adjust(-BPM_STEP)}
        type="button"
      >
        −
      </button>
      <span>{bpm.toFixed(0)} BPM</span>
      <button
        aria-label="Increase tempo"
        className="tempo-pill__adjust"
        onClick={() => adjust(BPM_STEP)}
        type="button"
      >
        +
      </button>
    </div>
  );
}
