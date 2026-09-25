import type { MediaItem, Palette } from "../media";
import type { ServerMediaRef, SessionOpenResponse } from "../session";

export type HarnessCapability =
  | "browser-dialogs"
  | "native-dialogs"
  | "session-paths"
  | "asset-urls"
  | "native-blob-write"
  | "render-hooks";

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
  canvasWidth: number;
  canvasHeight: number;
  durationSeconds: number;
  frameRate: number;
  frameCount: number;
  frameDuration: number;
  bpm: number;
  mainAudio?: MediaItem;
  renderFrameAt(playheadQ: number, playheadSeconds: number): Promise<void>;
  setPlayheadQ(playheadQ: number): void;
  onProgress(update: ExportProgress): void;
  onLog?(event: string, payload?: unknown): void;
};

export type ExportResult = {
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
  ): Promise<string | undefined>;
  prepareSave(
    filename: string,
    options?: SaveOptions,
  ): Promise<SaveTarget | null>;
  saveBlob(blob: Blob, target: SaveTarget): Promise<SaveMethod>;
  exportVideo(request: ExportRequest): Promise<ExportResult>;
};

declare global {
  interface Window {
    harness?: Harness;
  }
}
