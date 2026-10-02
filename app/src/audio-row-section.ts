// Collapse state for the timeline's Audio row, which is pinned to the bottom
// of the timeline. Collapsed, only a slim header with its toggle stays
// pinned. The preference is kept in local UI prefs like the Source Tracks
// section's (source-tracks-section.ts).

export const AUDIO_ROW_COLLAPSED_STORAGE_KEY = "zvid-audio-row-collapsed";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export function readAudioRowCollapsed(storage?: PrefsStorage) {
  try {
    return storage?.getItem(AUDIO_ROW_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeAudioRowCollapsed(
  storage: PrefsStorage | undefined,
  collapsed: boolean,
) {
  try {
    storage?.setItem(AUDIO_ROW_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Storage can be unavailable (private mode, quota); the toggle still works.
  }
}

// The collapse toggle's label: what pressing it does.
export function audioRowToggleLabel(collapsed: boolean) {
  return collapsed ? "Show audio waveform" : "Hide audio waveform";
}
