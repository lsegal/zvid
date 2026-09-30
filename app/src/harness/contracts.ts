import type { MediaItem, Palette } from "../media";
import type { ServerMediaRef, SessionOpenResponse } from "../session";
import type { SessionSettings } from "../session-settings";
import type { ExportEncoding } from "./export-encoding";

export type HarnessCapability =
  | "browser-dialogs"
  | "native-dialogs"
  | "session-paths"
  | "asset-urls"
  | "native-blob-write"
  | "render-hooks"
  | "reveal-saved-file";

export type SessionSelection =
  | {
      kind: "file";
      file: File;
    }
  | {
      kind: "workspace";
      rootName: string;
      sessionPath: string;
      sessionFile: File;
      files: WorkspaceFileRef[];
    }
  | {
      kind: "path";
      path: string;
      name: string;
    };

export type WorkspaceFileRef = {
  path: string;
  file: File;
};

export type MediaSelection =
  | {
      kind: "files";
      files: File[];
    }
  | {
      kind: "refs";
      refs: ServerMediaRef[];
    };

export type SaveFilePickerHandle = {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
};

export type SaveTarget =
  | {
      kind: "picker";
      filename: string;
      handle: SaveFilePickerHandle;
    }
  | {
      kind: "download";
      filename: string;
    }
  | {
      kind: "native-path";
      filename: string;
      path: string;
    };

export type SaveMethod = "picker" | "download" | "native-path";

export type SaveOptions = {
  mimeType?: string;
  extensions?: string[];
  description?: string;
};

export type ExportProgress = {
  phase: "idle" | "preparing" | "decoding-audio" | "rendering" | "muxing";
  progress: number | null;
  detail: string;
};

export type ExportRequest = {
  filename: string;
  saveTarget: SaveTarget;
  canvas: HTMLCanvasElement;
  // The canvas size, frame rate and encoding to export with.
  settings: SessionSettings;
  durationSeconds: number;
  frameCount: number;
  // Where on the session timeline the export starts; the video and the
  // main audio both begin there. Defaults to the session start.
  startSeconds?: number;
  bpm: number;
  mainAudio?: MediaItem;
  // Aborting stops the export before it saves anything.
  signal?: AbortSignal;
  renderFrameAt(playheadQ: number, playheadSeconds: number): Promise<void>;
  setPlayheadQ(playheadQ: number): void;
  // Awaited between frames so the rest of the app keeps running; defaults
  // to a zero-length timeout.
  yieldBetweenFrames?(): Promise<void>;
  onProgress(update: ExportProgress): void;
  onLog?(event: string, payload?: unknown): void;
};

export type ExportResult = {
  encoding: ExportEncoding;
  // The effective settings, like "1080×1920 · 30 fps · HEVC · 12 Mbps".
  summary: string;
  bytes: number;
  mimeType: string;
  muxedWith: string;
  saveMethod: SaveMethod;
};

export type Harness = {
  id: string;
  label: string;
  capabilities: Partial<Record<HarnessCapability, boolean>>;
  pickSession(): Promise<SessionSelection | null>;
  pickWorkspace?(): Promise<SessionSelection | null>;
  pickMedia(options?: { multiple?: boolean }): Promise<MediaSelection | null>;
  pickMediaFolder?(): Promise<MediaSelection | null>;
  openSession(selection: SessionSelection): Promise<SessionOpenResponse>;
  analyzeMedia(
    selection: MediaSelection,
    palettes: Palette[],
    startIndex: number,
  ): Promise<MediaItem[]>;
  readMediaBlob(
    target: Pick<MediaItem, "id" | "name" | "previewUrl" | "sourcePath">,
  ): Promise<Blob>;
  generateThumbnailAtTime?(
    media: MediaItem,
    timeSeconds: number,
    size?: { width: number; height: number },
  ): Promise<string | undefined>;
  prepareSave(
    filename: string,
    options?: SaveOptions,
  ): Promise<SaveTarget | null>;
  saveBlob(blob: Blob, target: SaveTarget): Promise<SaveMethod>;
  exportVideo(request: ExportRequest): Promise<ExportResult>;
  // Shows a saved file in the system file manager, selected. Present with
  // the "reveal-saved-file" capability; see canRevealSavedFile.
  revealSavedFile?(target: SaveTarget): Promise<void>;
  // Asks for confirmation, with `message`, before the app's window closes,
  // until the returned function is called.
  guardWindowClose?(message: string): () => void;
};

declare global {
  interface Window {
    harness?: Harness;
  }
}
