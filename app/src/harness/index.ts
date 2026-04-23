import type { Harness, HarnessCapability } from "./contracts";
import { maybeCreateTauriHarness } from "./tauri";
import { createWebHarness } from "./web";

function setHarness(nextHarness: Harness) {
  window.harness = nextHarness;
  window.dispatchEvent(
    new CustomEvent("zvid:harness-change", { detail: nextHarness }),
  );
}

export async function installHarness() {
  const webHarness = createWebHarness();
  setHarness(webHarness);

  const tauriHarness = await maybeCreateTauriHarness(webHarness);
  if (tauriHarness) {
    setHarness(tauriHarness);
    return tauriHarness;
  }

  return webHarness;
}

export function getHarness() {
  if (!window.harness) {
    throw new Error("window.harness is not installed yet.");
  }

  return window.harness;
}

export function supportsHarnessCapability(capability: HarnessCapability) {
  return Boolean(window.harness?.capabilities[capability]);
}

export type {
  Harness,
  HarnessCapability,
  MediaSelection,
  SaveMethod,
  SaveOptions,
  SaveTarget,
  SessionSelection,
} from "./contracts";
