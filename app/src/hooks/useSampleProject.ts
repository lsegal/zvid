import { useCallback, useEffect, useRef } from "react";
import type { WorkspaceBoot } from "../app/workspace-types";
import { MIDI_SAMPLE } from "../sample/midi-sample";
import { OPENING_SAMPLE } from "../sample/opening-sample";
import {
  buildSampleOpenPayload,
  shouldAutoOpenSample,
} from "../sample/sample-loader";
import type { SampleManifest } from "../sample/sample-manifest";
import type { SampleId } from "../sample/samples";
import type { SessionOpenResponse } from "../session";

// A sample with `layersCollapsed` collapses the Layers section when it
// opens; the others leave the user's choice as it is.
const SAMPLES: Record<
  SampleId,
  { manifest: SampleManifest; sessionText: string; layersCollapsed?: boolean }
> = { default: OPENING_SAMPLE, midi: MIDI_SAMPLE };

type SampleProjectInputs = {
  boot: Pick<WorkspaceBoot, "access" | "session" | "corruptKey">;
  // Whether the project is still empty: an automatic open never replaces
  // anything the user did in the meantime.
  isPristine: () => boolean;
  refuseReadOnlyEdit: () => boolean;
  openSamplePayload: (
    payload: SessionOpenResponse,
    record: boolean,
  ) => Promise<void>;
  setLayersCollapsed: (collapsed: boolean) => void;
  setStatus: (message: string) => void;
};

// File → Open → Samples, and the opening sample opened on its own when the
// app starts with nothing to restore. The sample opens at once; useSampleMedia then
// loads its media in place, like media syncing from a peer.
export function useSampleProject({
  boot,
  isPristine,
  refuseReadOnlyEdit,
  openSamplePayload,
  setLayersCollapsed,
  setStatus,
}: SampleProjectInputs) {
  const autoRef = useRef(false);
  const inputs = {
    isPristine,
    openSamplePayload,
    setLayersCollapsed,
    setStatus,
  };
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const open = useCallback(async (automatic: boolean, id: SampleId) => {
    if (automatic && !inputsRef.current.isPristine()) {
      return;
    }
    const { manifest, sessionText, layersCollapsed } = SAMPLES[id];
    try {
      await inputsRef.current.openSamplePayload(
        buildSampleOpenPayload(manifest, sessionText),
        !automatic,
      );
      if (layersCollapsed) {
        inputsRef.current.setLayersCollapsed(true);
      }
    } catch (error) {
      inputsRef.current.setStatus(
        `Could not open the sample: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const openSample = useCallback(
    (id: SampleId) => {
      if (refuseReadOnlyEdit()) {
        return;
      }
      void open(false, id);
    },
    [open, refuseReadOnlyEdit],
  );
  const handleOpenSample = useCallback(
    () => openSample("default"),
    [openSample],
  );

  useEffect(() => {
    if (autoRef.current) {
      return;
    }
    autoRef.current = true;
    if (
      shouldAutoOpenSample({
        access: boot.access,
        restored: boot.session !== null,
        corrupt: boot.corruptKey !== null,
        search: window.location.search,
        webdriver: navigator.webdriver === true,
      })
    ) {
      void open(true, "default");
    }
  }, [boot, open]);

  return { handleOpenSample, openSample };
}
