import { useEffect, useRef } from "react";
import { PALETTE } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { effectMediaPath } from "../fx/effect-media.ts";
import { setDrumSampleImporter } from "../fx/effects/drum-rack/drum-media.ts";
import { getHarness } from "../harness";
import { type MediaItem, toShareableMediaItem } from "../media";

export type DrumSampleImportInputs = {
  projectMediaItems: MediaItem[];
  refuseReadOnlyEdit: () => boolean;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  seedLocalMediaItems: (items: MediaItem[]) => void;
  cacheLocalMediaItems: (items: MediaItem[]) => Promise<void>;
  setStatus: (status: string) => void;
};

// Lets Drum Rack pads load their own samples: imports the audio file a pad
// is given, or one the user picks, into the media library as one undo
// step, and hands the pad the path it plays it by.
export function useDrumSampleImport({
  projectMediaItems,
  refuseReadOnlyEdit,
  commitProjectChange,
  seedLocalMediaItems,
  cacheLocalMediaItems,
  setStatus,
}: DrumSampleImportInputs) {
  const mediaCountRef = useRef(projectMediaItems.length);
  mediaCountRef.current = projectMediaItems.length;

  useEffect(() => {
    setDrumSampleImporter(async (files) => {
      if (refuseReadOnlyEdit()) {
        return undefined;
      }
      const harness = getHarness();
      const selection = files?.length
        ? { kind: "files" as const, files: [...files] }
        : await harness.pickMedia({ multiple: false });
      if (!selection) {
        return undefined;
      }
      try {
        const analyzed = await harness.analyzeMedia(
          selection,
          PALETTE,
          mediaCountRef.current,
        );
        const audio = analyzed.filter((item) => item.kind === "audio");
        const [first] = audio;
        if (!first) {
          setStatus("Choose an audio file to load onto the pad.");
          return undefined;
        }
        commitProjectChange("Import pad sample", (current) =>
          patchProjectState(current, {
            mediaItems: [
              ...current.mediaItems,
              ...audio.map((item) => toShareableMediaItem(item)),
            ],
          }),
        );
        seedLocalMediaItems(audio);
        void cacheLocalMediaItems(audio);
        setStatus(`Loaded ${first.name} onto the pad.`);
        return effectMediaPath(first);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Pad sample import failed: ${message}`);
        return undefined;
      }
    });
    return () => setDrumSampleImporter(undefined);
  }, [
    cacheLocalMediaItems,
    commitProjectChange,
    refuseReadOnlyEdit,
    seedLocalMediaItems,
    setStatus,
  ]);
}
