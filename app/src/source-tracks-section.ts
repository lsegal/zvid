// Collapse state for the timeline's Source Tracks section. The preference is
// kept in local UI prefs like the inspector's, and only applies while there
// are source tracks to hide: an empty section always shows its call to action.

export const SOURCE_TRACKS_COLLAPSED_STORAGE_KEY =
  "zvid-source-tracks-collapsed";

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

export function readSourceTracksCollapsed(storage?: PrefsStorage) {
  try {
    return storage?.getItem(SOURCE_TRACKS_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSourceTracksCollapsed(
  storage: PrefsStorage | undefined,
  collapsed: boolean,
) {
  try {
    storage?.setItem(SOURCE_TRACKS_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Storage can be unavailable (private mode, quota); the toggle still works.
  }
}

export function isSourceTracksSectionCollapsed(
  collapsedPref: boolean,
  trackCount: number,
) {
  return collapsedPref && trackCount > 0;
}

export function formatSourceTracksSummary(trackCount: number) {
  return `${trackCount} ${trackCount === 1 ? "track" : "tracks"}`;
}
