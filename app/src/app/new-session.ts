// File → New Session: the blank project it opens, whether starting one
// would discard unsaved work, and its keyboard shortcut.
import {
  createProjectHistoryState,
  type ProjectHistoryState,
} from "../project-history.ts";
import {
  matchesShortcutKey,
  type ShortcutKeyEvent,
} from "../shortcuts/keys.ts";
import { INITIAL_PROJECT_STATE } from "./constants.ts";
import type { ProjectState } from "./types.ts";

export const NEW_SESSION_SHORTCUT = "Mod+N";

// The default layers and timeline settings, no source tracks, and no undo
// history.
export function createNewSessionHistory(): ProjectHistoryState<ProjectState> {
  return createProjectHistoryState(INITIAL_PROJECT_STATE);
}

export function isPristineProjectHistory(
  history: ProjectHistoryState<ProjectState>,
) {
  return (
    history.present === INITIAL_PROJECT_STATE &&
    !history.past.length &&
    !history.future.length
  );
}

// Whether starting a new session would discard edits that were never
// saved. A blank project has nothing to lose even when its flag is set.
export function hasUnsavedSessionChanges(
  history: ProjectHistoryState<ProjectState>,
  unsavedFlag: boolean,
) {
  return unsavedFlag && !isPristineProjectHistory(history);
}

// ⌘N / Ctrl+N. Browsers keep it for a new window, so only the desktop app
// takes it.
export function isNewSessionShortcut(
  event: ShortcutKeyEvent & Pick<KeyboardEvent, "repeat">,
  isDesktopApp: boolean,
) {
  return (
    isDesktopApp &&
    !event.repeat &&
    !event.shiftKey &&
    matchesShortcutKey(NEW_SESSION_SHORTCUT, event)
  );
}
