import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceBoot } from "../app/workspace-types";
import {
  SampleLoadDialog,
  type SampleLoadState,
} from "../components/SampleLoadDialog";
import { cacheMediaBlob, getCachedMediaBlob } from "../media-cache";
import { OPENING_SAMPLE } from "../sample/opening-sample";
import {
  buildSampleOpenPayload,
  loadSampleAssets,
  SampleLoadCancelledError,
  type SampleLoadDeps,
  sha256Hex,
  shouldAutoOpenSample,
} from "../sample/sample-loader";
import type { SessionOpenResponse } from "../session";

export const SAMPLE_LOAD_DEPS: SampleLoadDeps = {
  fetch: (url, init) => fetch(url, init),
  getCached: getCachedMediaBlob,
  cache: cacheMediaBlob,
  digest: sha256Hex,
};

type SampleProjectInputs = {
  boot: Pick<WorkspaceBoot, "access" | "session" | "corruptKey">;
  // Whether the project is still empty: an automatic open never replaces
  // anything the user did while the sample loaded.
  isPristine: () => boolean;
  refuseReadOnlyEdit: () => boolean;
  openSamplePayload: (payload: SessionOpenResponse) => Promise<void>;
  setStatus: (message: string) => void;
};

// File → Open Sample, and the sample opened on its own when the app starts
// with nothing to restore. The media loads into the media cache first, so a
// cancelled or failed load leaves the current project as it was.
export function useSampleProject({
  boot,
  isPristine,
  refuseReadOnlyEdit,
  openSamplePayload,
  setStatus,
}: SampleProjectInputs) {
  const [state, setState] = useState<SampleLoadState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const autoRef = useRef(false);
  const inputsRef = useRef({ isPristine, openSamplePayload, setStatus });
  inputsRef.current = { isPristine, openSamplePayload, setStatus };

  const load = useCallback(async (automatic: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { manifest, sessionText } = OPENING_SAMPLE;
    try {
      await loadSampleAssets(manifest, SAMPLE_LOAD_DEPS, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (controllerRef.current === controller) {
            setState({ status: "loading", progress });
          }
        },
      });
      if (controllerRef.current !== controller) {
        return;
      }
      controllerRef.current = null;
      setState({ status: "idle" });
      if (automatic && !inputsRef.current.isPristine()) {
        return;
      }
      await inputsRef.current.openSamplePayload(
        buildSampleOpenPayload(manifest, sessionText),
      );
    } catch (error) {
      if (controllerRef.current !== controller) {
        return;
      }
      controllerRef.current = null;
      if (error instanceof SampleLoadCancelledError) {
        setState({ status: "idle" });
        inputsRef.current.setStatus("Opening the sample was cancelled.");
        return;
      }
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const handleOpenSample = useCallback(() => {
    if (refuseReadOnlyEdit()) {
      return;
    }
    void load(false);
  }, [load, refuseReadOnlyEdit]);

  const cancelSampleLoad = useCallback(() => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    setState({ status: "idle" });
    if (controller) {
      inputsRef.current.setStatus("Opening the sample was cancelled.");
    }
  }, []);

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
      void load(true);
    }
  }, [boot, load]);

  return {
    handleOpenSample,
    dialog: (
      <SampleLoadDialog
        onCancel={cancelSampleLoad}
        onDismiss={() => setState({ status: "idle" })}
        onRetry={handleOpenSample}
        state={state}
      />
    ),
  };
}
