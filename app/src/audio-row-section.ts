// The timeline's Audio row ends the timeline and is pinned to the bottom of
// the panel when there is room for it, with a collapse toggle that hides its
// waveform. The collapse preference is kept in local UI prefs like the Source
// Tracks section's (source-tracks-section.ts).

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

// The panel height the Audio row needs to pin itself to the bottom: room for
// the ruler, the expanded row and a couple of layers between them. In a
// shorter panel, pinned, it would cover most of the lanes, so there it just
// ends the timeline and scrolls with it.
export const AUDIO_ROW_PIN_MIN_PANEL_HEIGHT = 320;

export function isAudioRowPinned(panelHeight: number) {
  return panelHeight >= AUDIO_ROW_PIN_MIN_PANEL_HEIGHT;
}
