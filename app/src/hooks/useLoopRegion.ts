import { useCallback, useState } from "react";
import type { LoopRegion } from "../app/loop-region.ts";
import type { PlaybackSelection } from "../app/playback-selection.ts";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import type { ProjectStore } from "./useProjectStore.ts";

export type LoopRegionInputs = {
  project: Pick<ProjectState, "loopRegion">;
  store: Pick<ProjectStore, "commitViewChange">;
};

function sameLoopRegion(a: LoopRegion | null, b: LoopRegion | null) {
  return a === b || (!!a && !!b && a.startQ === b.startQ && a.endQ === b.endQ);
}

// The playback selection dragged out in the ruler's loop strip, and the loop
// region L locks it into, which playback loops between. The selection is
// view state only. The loop region lives in the project, so each edit is an
// undo entry, as a view change like zoom so a read-only tab can still loop.
// A loop bar drag shows a draft and commits once, when it ends.
export function useLoopRegion({ project, store }: LoopRegionInputs) {
  const { commitViewChange } = store;
  const [playbackSelection, setPlaybackSelection] =
    useState<PlaybackSelection | null>(null);
  const [loopRegionDraft, setLoopRegionDraft] = useState<LoopRegion | null>(
    null,
  );
  const loopRegion = loopRegionDraft ?? project.loopRegion ?? null;

  const setLoopRegion = useCallback(
    (region: LoopRegion | null, label = region ? "Set loop" : "Clear loop") => {
      setLoopRegionDraft(null);
      commitViewChange(label, (current) =>
        sameLoopRegion(current.loopRegion ?? null, region)
          ? current
          : patchProjectState(current, { loopRegion: region ?? undefined }),
      );
    },
    [commitViewChange],
  );

  // Turns the playback selection into the loop region, clearing it.
  const lockPlaybackSelection = useCallback(() => {
    if (!playbackSelection) {
      return;
    }

    setLoopRegion({ ...playbackSelection });
    setPlaybackSelection(null);
  }, [playbackSelection, setLoopRegion]);

  return {
    playbackSelection,
    setPlaybackSelection,
    loopRegion,
    setLoopRegion,
    previewLoopRegion: setLoopRegionDraft,
    lockPlaybackSelection,
  };
}
