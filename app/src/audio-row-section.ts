// The timeline's Audio row is docked at the bottom of the timeline panel,
// with a toggle that collapses it to a compact row. The collapse preference
// is kept in local UI prefs like the Source Tracks section's
// (source-tracks-section.ts).

// The expanded Audio row's default height, which dragging its separator
// changes (#1058).
export const AUDIO_ROW_HEIGHT = 78;

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
  return collapsed ? "Expand audio row" : "Collapse audio row";
}
