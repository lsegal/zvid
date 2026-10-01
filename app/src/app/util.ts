import { hasMediaExtension } from "../harness/media-extensions.ts";
import { PALETTE } from "./constants.ts";
import type { Lane, SourceTrackDropTarget } from "./types.ts";

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function isEditableEventTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function getSwatch(colorIndex: number) {
  return PALETTE[Math.abs(colorIndex) % PALETTE.length] ?? PALETTE[0];
}

export function basename(path: string | undefined) {
  if (!path) {
    return "";
  }

  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? path;
}

export function stripFilenameExtension(value: string) {
  return value.replace(/\.[^/.]+$/, "") || value;
}

export function getDraggedMediaFiles(dataTransfer: DataTransfer | null) {
  const directFiles = Array.from(dataTransfer?.files ?? []);
  const itemFiles =
    directFiles.length > 0
      ? directFiles
      : Array.from(dataTransfer?.items ?? [])
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));

  return itemFiles.filter((file) => isMediaFile(file));
}

function isMediaFileType(type: string) {
  return type.startsWith("video/") || type.startsWith("audio/");
}

export function isMediaFile(file: { name: string; type: string }) {
  return isMediaFileType(file.type) || hasMediaExtension(file.name);
}

type DataTransferLike = {
  types: ArrayLike<string>;
  files?: ArrayLike<{ name: string; type: string }> | null;
  items?: ArrayLike<{ kind: string; type: string }> | null;
};

/**
 * `accept`: media may be dragged, with `fileCount` media files when known (0
 * when the browser exposes no file details); `reject`: only non-media files.
 */
export type SourceTrackDragState =
  | { kind: "accept"; fileCount: number }
  | { kind: "reject" }
  | { kind: "none" };

/**
 * Classifies an in-progress file drag over the source tracks. During
 * `dragover` browsers hide `files`, so this relies on the file items' MIME
 * types, accepting an empty type since the OS may not know the format; the
 * dropped files themselves are filtered with getDraggedMediaFiles on `drop`.
 */
export function getSourceTrackDragState(
  dataTransfer: DataTransferLike | null,
): SourceTrackDragState {
  if (!dataTransfer) {
    return { kind: "none" };
  }

  const files = Array.from(dataTransfer.files ?? []);
  const fileItems = Array.from(dataTransfer.items ?? []).filter(
    (item) => item.kind === "file",
  );
  const fileCount = files.length
    ? files.filter((file) => isMediaFile(file)).length
    : fileItems.filter((item) => !item.type || isMediaFileType(item.type))
        .length;
  if (fileCount) {
    return { kind: "accept", fileCount };
  }

  if (files.length || fileItems.length) {
    return { kind: "reject" };
  }

  return Array.from(dataTransfer.types).includes("Files")
    ? { kind: "accept", fileCount: 0 }
    : { kind: "none" };
}

/**
 * The source track drop target containing a drag event's target: a track row
 * (its label and clips included), the new-track drop row, or the header while
 * it takes drops. Anywhere else is no target.
 */
export function getSourceTrackDropTarget(
  target: EventTarget | null,
): SourceTrackDropTarget | null {
  if (!target || typeof (target as Element).closest !== "function") {
    return null;
  }

  const element = (target as Element).closest(
    "[data-source-track-drop-target]",
  );
  const kind = element?.getAttribute("data-source-track-drop-target");
  const trackId = element?.getAttribute("data-source-track-id");
  if (kind === "track" && trackId) {
    return { kind: "track", trackId };
  }

  return kind === "new-track" ? { kind: "new-track" } : null;
}

export function hasDraggedFileData(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types).includes("Files")) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file",
  );
}

export function buildDraggedMediaKey(files: readonly File[]) {
  return files
    .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
    .join("|");
}

export function getNextLaneNumber(lanes: Lane[]) {
  return lanes.length + 1;
}

export function randomFloat() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

export function pickRandom<T>(items: readonly T[]) {
  if (!items.length) {
    return undefined;
  }

  return items[Math.floor(randomFloat() * items.length)];
}

export function normalizeMediaPath(value: string | undefined) {
  return (value ?? "").replaceAll("/", "\\").toLowerCase();
}

export function logClient(event: string, payload?: unknown) {
  if (payload === undefined) {
    console.info(`[zvid] ${event}`);
    return;
  }

  console.info(`[zvid] ${event}`, payload);
}

export function revokeObjectUrlIfNeeded(url: string | undefined) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export function sanitizeFilenameSegment(value: string) {
  const sanitized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    if (code < 0x20 || '<>:"/\\|?*'.includes(character)) {
      return "-";
    }

    return character;
  })
    .join("")
    .trim();
  return sanitized || "zvid-session";
}
