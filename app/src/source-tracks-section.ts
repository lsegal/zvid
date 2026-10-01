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

// While locked, source clips can't be moved, resized or retimed and source
// tracks can't be deleted or reordered; this says why.
export const SOURCE_TRACKS_LOCKED_TITLE = "Source tracks are locked";

// The lock button's label and the history label of switching to `locked`.
export function sourceTracksLockLabel(locked: boolean) {
  return locked ? "Lock source tracks" : "Unlock source tracks";
}
