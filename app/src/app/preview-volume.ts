import { PREVIEW_VOLUME_STORAGE_KEY } from "./constants.ts";
import { clamp } from "./util.ts";

// How loud the preview plays, a per-viewer preference kept out of the
// project, its history and the export.
export type PreviewVolume = { volume: number; muted: boolean };

export const DEFAULT_PREVIEW_VOLUME: PreviewVolume = {
  volume: 1,
  muted: false,
};

// Muted and zero both play nothing, and show the muted icon.
export function isPreviewSilent({ volume, muted }: PreviewVolume) {
  return muted || volume <= 0;
}

// Moving the slider above zero unmutes; the slider keeps its own position
// while muted.
export function changePreviewVolume(
  state: PreviewVolume,
  volume: number,
): PreviewVolume {
  const next = clamp(volume, 0, 1);
  return { volume: next, muted: next > 0 ? false : state.muted };
}

// Unmuting a slider left at zero brings it back to full volume, so the
// button always makes the preview audible again.
export function togglePreviewMuted(state: PreviewVolume): PreviewVolume {
  if (!isPreviewSilent(state)) {
    return { ...state, muted: true };
  }
  return { volume: state.volume > 0 ? state.volume : 1, muted: false };
}

export function formatPreviewVolume(volume: number) {
  return `${Math.round(volume * 100)}%`;
}

export function readPreviewVolume(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): PreviewVolume {
  try {
    const stored = JSON.parse(
      storage?.getItem(PREVIEW_VOLUME_STORAGE_KEY) ?? "null",
    );
    if (!stored || !Number.isFinite(stored.volume)) {
      return DEFAULT_PREVIEW_VOLUME;
    }
    return {
      volume: clamp(stored.volume, 0, 1),
      muted: stored.muted === true,
    };
  } catch {
    return DEFAULT_PREVIEW_VOLUME;
  }
}

export function writePreviewVolume(
  state: PreviewVolume,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
) {
  try {
    storage?.setItem(PREVIEW_VOLUME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be full or blocked; the volume still applies this session.
  }
}
