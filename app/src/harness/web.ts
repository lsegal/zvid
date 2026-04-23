import type { SessionOpenResponse } from "../session";
import type {
  Harness,
  SaveFilePickerHandle,
  SaveOptions,
  SaveTarget,
  SessionSelection,
} from "./contracts";
import {
  analyzeMediaSelection,
  exportVideo,
  generateThumbnailFromUrlAtTime,
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

export function createWebHarness(): Harness {
  return {
    id: "web",
    label: "Web",
    capabilities: {
      "browser-dialogs": true,
    },
    async pickSession(): Promise<SessionSelection | null> {
      const files = await pickFiles({
        accept: ".lvp,application/json",
        multiple: false,
      });
      const file = files[0];
      return file ? { kind: "file", file } : null;
    },
    async pickMedia() {
      const files = await pickFiles({
        accept:
          "video/*,audio/*,.mp4,.mov,.mkv,.webm,.avi,.wav,.mp3,.m4a,.flac,.aif,.aiff",
        multiple: true,
      });
      return files.length ? { kind: "files", files } : null;
    },
    async openSession(selection): Promise<SessionOpenResponse> {
      if (selection.kind === "path") {
        const response = await fetch("/api/session/open", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionPath: selection.path,
          }),
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

        return payload;
      }

      const response = await fetch("/api/session/open-file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionName: selection.file.name,
          sessionContents: await selection.file.text(),
        }),
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

      return payload;
    },
    analyzeMedia: analyzeMediaSelection,
    readMediaBlob,
    generateThumbnailAtTime(media, timeSeconds) {
      if (!media.hasVideo) {
        return Promise.resolve(undefined);
      }

      return generateThumbnailFromUrlAtTime(media.previewUrl, timeSeconds);
    },
    prepareSave,
    saveBlob,
    exportVideo(request) {
      return exportVideo(request, saveBlob);
    },
  };
}
