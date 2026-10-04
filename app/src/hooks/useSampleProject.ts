import { useCallback, useEffect, useRef } from "react";
import type { WorkspaceBoot } from "../app/workspace-types";
import { OPENING_SAMPLE } from "../sample/opening-sample";
import {
  buildSampleOpenPayload,
  shouldAutoOpenSample,
} from "../sample/sample-loader";
import type { SessionOpenResponse } from "../session";

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
  setStatus: (message: string) => void;
};

// File → Open Sample, and the sample opened on its own when the app starts
// with nothing to restore. The sample opens at once; useSampleMedia then
// loads its media in place, like media syncing from a peer.
export function useSampleProject({
  boot,
  isPristine,
  refuseReadOnlyEdit,
  openSamplePayload,
  setStatus,
}: SampleProjectInputs) {
  const autoRef = useRef(false);
  const inputsRef = useRef({ isPristine, openSamplePayload, setStatus });
  inputsRef.current = { isPristine, openSamplePayload, setStatus };

  const open = useCallback(async (automatic: boolean) => {
    if (automatic && !inputsRef.current.isPristine()) {
      return;
    }
    const { manifest, sessionText } = OPENING_SAMPLE;
    try {
      await inputsRef.current.openSamplePayload(
        buildSampleOpenPayload(manifest, sessionText),
        !automatic,
      );
    } catch (error) {
      inputsRef.current.setStatus(
        `Could not open the sample: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const handleOpenSample = useCallback(() => {
    if (refuseReadOnlyEdit()) {
      return;
    }
    void open(false);
  }, [open, refuseReadOnlyEdit]);

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
      void open(true);
    }
  }, [boot, open]);

  return { handleOpenSample };
}
