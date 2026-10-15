// Collapse state for the timeline's Layers area, which the layers toggle in
// the ruler's label and the collapsed Layers header's expander show and hide
// (#1453). The preference is kept in local UI prefs like the Source Tracks
// section's (source-tracks-section.ts).

export const LAYERS_COLLAPSED_STORAGE_KEY = "zvid-layers-collapsed";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export function readLayersCollapsed(storage?: PrefsStorage) {
  try {
    return storage?.getItem(LAYERS_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeLayersCollapsed(
  storage: PrefsStorage | undefined,
  collapsed: boolean,
) {
  try {
    storage?.setItem(LAYERS_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Storage can be unavailable (private mode, quota); the toggle still works.
  }
}

// The toggle's label: what pressing it does.
export function layersToggleLabel(collapsed: boolean) {
  return collapsed ? "Show layers" : "Hide layers";
}
