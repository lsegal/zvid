import type { LoopRegion } from "../app/loop-region.ts";
import type { ProjectState, SourceTrackDropTarget } from "../app/types.ts";
import type { ExportRange } from "../export-options.ts";
import type { MediaItem } from "../media.ts";
import type { ControlInput, ControlInputSchema } from "./schema.ts";

// Why a command failed: its input broke its schema (`invalid_input`), named
// something the session doesn't have (`not_found`), asked for something the
// session can't do right now (`unavailable`, such as playing with no clips or
// editing a read-only tab), or failed while running (`failed`).
export type ControlErrorCode =
  | "invalid_input"
  | "unknown_command"
  | "not_found"
  | "unavailable"
  | "failed";

export type ControlError = {
  code: ControlErrorCode;
  message: string;
  // Each problem with the input, for `invalid_input`.
  problems?: string[];
};

// Every command resolves to one of these and never throws, so a tool-calling
// loop can hand the result straight back to the model.
export type ControlResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ControlError };

/** Thrown by a command to fail with `code`; the surface turns it into a result. */
export class ControlFailure extends Error {
  readonly code: ControlErrorCode;

  constructor(code: ControlErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// How an export the control surface started ended.
export type ControlExportOutcome =
  | {
      kind: "done";
      fileName: string;
      summary: string;
      bytes: number;
      mimeType: string;
      // An object URL holding the file, when it was kept in memory.
      url?: string;
    }
  | { kind: "failed"; message: string }
  | { kind: "canceled" };

export type ControlExportRequest = {
  fileName: string;
  // Keep the file in memory and return an object URL for it, or hand it to
  // the browser's download flow (or, in the desktop app, write it to `path`).
  destination: "memory" | "download" | "path";
  path?: string;
  range?: ExportRange;
};

/**
 * What the commands drive: the running app, or a stand-in in tests. Each
 * edit takes effect before the method returns, so the next command sees it.
 */
export type ControlHost = {
  getProject(): ProjectState;
  // Applies `updater` to the project as one undoable edit named `label`.
  commit(label: string, updater: (current: ProjectState) => ProjectState): void;
  isReadOnly(): boolean;
  canUndo(): string | undefined;
  canRedo(): string | undefined;
  undo(): void;
  redo(): void;
  // Starts a blank session, discarding the current one.
  newSession(): void;
  hasUnsavedChanges(): boolean;
  // Why a new session can't start now, such as while collaborating.
  newSessionBlocker(): string | undefined;
  getPlayheadQ(): number;
  setPlayheadQ(quarters: number): void;
  isPlaying(): boolean;
  // Starts playback from the playhead; false when there is nothing to play.
  play(): boolean;
  pause(): void;
  getLoop(): LoopRegion | null;
  setLoop(loop: LoopRegion | null): void;
  getSelectedClipId(): string | undefined;
  selectClip(clipId: string | undefined): void;
  importMedia(
    files: File[],
    target: SourceTrackDropTarget,
  ): Promise<{ imported: MediaItem[]; error?: string }>;
  exportVideo(request: ControlExportRequest): Promise<ControlExportOutcome>;
  // Whether exports can be written to a file path (the desktop app).
  canExportToPath(): boolean;
  fetch(url: string): Promise<Response>;
};

export type ControlCommand = {
  name: string;
  // What the command does, for the model reading the tool list.
  description: string;
  inputSchema: ControlInputSchema;
  // Commands that change the session are refused in a read-only tab.
  edits?: boolean;
  run(host: ControlHost, input: ControlInput): unknown | Promise<unknown>;
};
