import type { ImportNoticeContent } from "../components/ImportNotice";
import type { WorkspaceLock } from "../workspace-lock.ts";
import type { WorkspaceSession } from "../workspace-session.ts";
import type { ProjectState } from "./types.ts";

// What a refresh restores besides the project and its history.
export type WorkspaceView = {
  playheadQ: number;
  selectedClipId?: string;
  selectedLaneId?: string;
  // A selected source track or clip, kept apart from the layer and clip.
  selectedSourceTrackId?: string;
  selectedSourceSpanId?: string;
  scrollLeft: number;
  scrollTop: number;
};

export type SavedWorkspaceSession = WorkspaceSession<
  ProjectState,
  WorkspaceView,
  ImportNoticeContent
>;

// "owner" autosaves. "blocked" is waiting on the other-tab prompt, and
// "read-only" and "taken-over" leave the saved session to another tab.
// "joiner" opened an invite link and saves nothing over its own session.
export type WorkspaceAccess =
  | "owner"
  | "blocked"
  | "read-only"
  | "taken-over"
  | "joiner";

export type WorkspaceBoot = {
  session: SavedWorkspaceSession | null;
  // Set when the saved session could not be read and was set aside.
  corruptKey: string | null;
  access: WorkspaceAccess;
  lock: WorkspaceLock;
};
