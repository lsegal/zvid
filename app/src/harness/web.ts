import {
  importAls,
  isAlsSession,
  probeAlsRecordings,
  resolveAlsMedia,
  withFormatNotes,
} from "../als-import";
import {
  isProjectArchiveFilename,
  openProjectArchive,
} from "../project-archive-open";
import type { LvpSession, SessionOpenResponse } from "../session";
import { detectOpenedSessionFormat } from "../session-format";
import type {
  Harness,
  MediaSelection,
  SaveFilePickerHandle,
  SaveOptions,
  SaveTarget,
  SessionSelection,
} from "./contracts";
import { exportVideo } from "./export";
import { hasMediaExtension, MEDIA_EXTENSIONS } from "./media-extensions";
import { buildFileOpenPayload } from "./open-payload";
import {
  analyzeMediaSelection,
  generateThumbnailFromUrlAtTime,
  probeRecordingFrames,
} from "./web-media";

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFilePickerHandle>;
};

type DirectoryInput = HTMLInputElement & {
  webkitdirectory: boolean;
  directory: boolean;
};

function buildPickerAccept(options?: SaveOptions) {
  const extensions = options?.extensions?.length
    ? options.extensions
    : [".mp4"];
  const mimeType = options?.mimeType ?? "video/mp4";
  return {
    [mimeType]: extensions,
  };
}

function pickFiles(options: { accept: string; multiple: boolean }) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.multiple = options.multiple;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.addEventListener(
      "change",
      () => {
        resolve(Array.from(input.files ?? []));
        input.remove();
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

function pickDirectoryFiles() {
  return new Promise<File[] | null>((resolve) => {
    const input = document.createElement("input") as DirectoryInput;
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.directory = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();

        resolve(files.length ? files : null);
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

async function pickMediaFolder(): Promise<MediaSelection | null> {
  const entries = await pickDirectoryFiles();
  if (!entries) {
    return null;
  }

  const files = entries.filter(
    (file) =>
      file.type.startsWith("video/") ||
      file.type.startsWith("audio/") ||
      hasMediaExtension(file.name),
  );
  return { kind: "files", files };
}

// Fills an imported Live set's recording metadata from the refs the server
// located, then drops those refs so only the session's media is hydrated. A
// session opened from an `.lvp` gets the canvas size and frame rate it lacks
// from its media instead.
async function finishSessionOpen(
  payload: SessionOpenResponse,
): Promise<SessionOpenResponse> {
  const { recordingRefs, ...rest } = payload;
  if (!rest.alsImport) {
    return {
      ...rest,
      session: await detectOpenedSessionFormat(
        rest.session,
        rest.mediaRefs,
        probeRecordingFrames,
      ),
    };
  }

  if (!recordingRefs?.length) {
    return rest;
  }

  const { session, formatNotes } = await probeAlsRecordings(
    rest.session,
    recordingRefs,
    probeRecordingFrames,
  );
  return {
    ...rest,
    session,
    alsImport: withFormatNotes(rest.alsImport, formatNotes),
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function postSessionOpen(
  endpoint: string,
  body: Record<string, string>,
): Promise<SessionOpenResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as
    | SessionOpenResponse
    | { error: string };
  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload
        ? payload.error
        : `Request failed with ${response.status}`,
    );
  }

  return finishSessionOpen(payload);
}

async function prepareSave(
  filename: string,
  options?: SaveOptions,
): Promise<SaveTarget> {
  const pickerWindow = window as SaveFilePickerWindow;
  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: options?.description ?? "Media export",
          accept: buildPickerAccept(options),
        },
      ],
    });
    return {
      kind: "picker",
      filename,
      handle,
    };
  }

  return {
    kind: "download",
    filename,
  };
}

async function saveBlob(blob: Blob, target: SaveTarget) {
  if (target.kind === "picker") {
    const writable = await target.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "picker" as const;
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = target.filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  return "download" as const;
}

async function readMediaBlob(target: { name: string; previewUrl: string }) {
  if (!target.previewUrl) {
    throw new Error(
      `No browser-readable media URL is available for ${target.name}.`,
    );
  }

  const response = await fetch(target.previewUrl);
  if (!response.ok) {
    throw new Error(`Failed to read ${target.name}: ${response.status}`);
  }

  return response.blob();
}

// The browser shows its own leave-page prompt; it ignores `message`.
function guardWindowClose() {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}

export function createWebHarness(): Harness {
  return {
    id: "web",
    label: "Web",
    capabilities: {
      "browser-dialogs": true,
    },
    async pickSession(): Promise<SessionSelection | null> {
      const files = await pickFiles({
        accept: ".zvd,.lvp,.als,application/json",
        multiple: false,
      });
      const file = files[0];
      if (!file) {
        return null;
      }

      return { kind: "file", file };
    },
    guardWindowClose,
    async pickMedia(options) {
      const files = await pickFiles({
        accept: [
          "video/*",
          "audio/*",
          ...MEDIA_EXTENSIONS.map((ext) => `.${ext}`),
        ].join(","),
        multiple: options?.multiple ?? true,
      });
      return files.length ? { kind: "files", files } : null;
    },
    pickMediaFolder,
    async openSession(selection): Promise<SessionOpenResponse> {
      if (selection.kind === "path") {
        return postSessionOpen("/api/session/open", {
          sessionPath: selection.path,
        });
      }

      const bytes = new Uint8Array(await selection.file.arrayBuffer());
      // The dev server reads only JSON and Live sets, so an archive is
      // unpacked here.
      if (isProjectArchiveFilename(selection.file.name)) {
        return finishSessionOpen(
          await openProjectArchive(bytes, selection.file.name),
        );
      }

      const isAls = isAlsSession(bytes, selection.file.name);

      // The deployed Worker has no session endpoints, so only the dev server
      // can resolve the session's on-disk media paths.
      if (!import.meta.env.DEV) {
        if (isAls) {
          const imported = await importAls(bytes, selection.file.name);
          const { session, summary } = resolveAlsMedia(imported, () => null);
          return {
            ...buildFileOpenPayload(session, selection.file.name),
            alsImport: summary,
          };
        }

        const session = JSON.parse(
          new TextDecoder().decode(bytes),
        ) as LvpSession;
        return buildFileOpenPayload(session, selection.file.name);
      }

      return postSessionOpen(
        "/api/session/open-file",
        isAls
          ? {
              sessionName: selection.file.name,
              sessionBase64: bytesToBase64(bytes),
            }
          : {
              sessionName: selection.file.name,
              sessionContents: new TextDecoder().decode(bytes),
            },
      );
    },
    analyzeMedia: analyzeMediaSelection,
    readMediaBlob,
    generateThumbnailAtTime(media, timeSeconds, size) {
      if (!media.hasVideo) {
        return Promise.resolve(undefined);
      }

      return generateThumbnailFromUrlAtTime(
        media.previewUrl,
        timeSeconds,
        size,
      );
    },
    prepareSave,
    saveBlob,
    exportVideo(request) {
      return exportVideo(request, saveBlob);
    },
  };
}
