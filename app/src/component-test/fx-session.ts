import type { ProjectState } from "../app/types.ts";
import { parseSavedWorkspaceSession } from "../app/workspace-boot.ts";
import type { ProjectHistoryState } from "../project-history";
import { serializeWorkspaceSession } from "../workspace-session.ts";

// The two ways a session is kept and brought back, through the same
// serialization App uses: the autosave a refresh restores (with its undo
// history) and a Sessions library entry (without it).

const VIEW = { playheadQ: 0, scrollLeft: 0, scrollTop: 0 };

// The payload the workspace autosave writes for `history`.
export function autosavePayload(history: ProjectHistoryState<ProjectState>) {
  return serializeWorkspaceSession({
    history: {
      past: history.past,
      present: history.present,
      future: history.future,
    },
    view: VIEW,
    source: { kind: "none" },
  });
}

// The payload File › Save writes to the Sessions library for `history`:
// its present state alone, as useSessionLibrary's entries keep it.
export function libraryPayload(history: ProjectHistoryState<ProjectState>) {
  return serializeWorkspaceSession({
    history: { past: [], present: history.present, future: [] },
    view: { ...VIEW, hasUnsavedChanges: false },
    source: { kind: "none" },
  });
}

// The history a refresh, or opening the entry, restores from `payload`.
export function restoreHistory(
  payload: string,
): ProjectHistoryState<ProjectState> {
  const { history } = parseSavedWorkspaceSession(payload);
  return {
    past: history.past,
    present: history.present,
    future: history.future,
  };
}
