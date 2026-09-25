/**
 * Drag-and-drop classification for the Audio lane, which sets or replaces the
 * main audio track. Only audio files are accepted; anything else is rejected
 * so the lane shows no drop affordance and ignores the drop.
 */

/** Audio file extensions (without the leading dot) accepted as main audio. */
export const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "flac", "aif", "aiff"];

/** Attribute that marks the Audio lane as a main-audio drop target. */
export const MAIN_AUDIO_DROP_TARGET_ATTRIBUTE = "data-main-audio-drop-target";

type FileLike = { name: string; type: string };

type DataTransferItemLike = { kind: string; type: string };

type DataTransferLike = {
  types: ArrayLike<string>;
  files?: ArrayLike<FileLike> | null;
  items?: ArrayLike<DataTransferItemLike> | null;
};

/** `accept`: an audio file is dragged; `reject`: files, but none are audio. */
export type MainAudioDragState = "accept" | "reject" | "none";

export function isAudioFile(file: FileLike) {
  if (file.type) {
    return file.type.startsWith("audio/");
  }

  const lower = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(`.${extension}`));
}

/** Returns the first dropped audio file, or undefined when there is none. */
export function getDroppedAudioFile<T extends FileLike>(
  files: ArrayLike<T> | null | undefined,
): T | undefined {
  return Array.from(files ?? []).find((file) => isAudioFile(file));
}

/**
 * Classifies an in-progress drag over the Audio lane. During `dragover`
 * browsers hide file names, so this relies on the file items' MIME types and
 * only falls back to `files` when they are exposed (for example on drop).
 */
export function getMainAudioDragState(
  dataTransfer: DataTransferLike | null,
): MainAudioDragState {
  if (!dataTransfer) {
    return "none";
  }

  const files = Array.from(dataTransfer.files ?? []);
  if (files.length) {
    return getDroppedAudioFile(files) ? "accept" : "reject";
  }

  const fileItems = Array.from(dataTransfer.items ?? []).filter(
    (item) => item.kind === "file",
  );
  if (fileItems.length) {
    return fileItems.some((item) => item.type.startsWith("audio/"))
      ? "accept"
      : "reject";
  }

  return Array.from(dataTransfer.types).includes("Files") ? "reject" : "none";
}

/** Whether a drag event target lies within the Audio lane. */
export function isWithinMainAudioDropTarget(target: EventTarget | null) {
  return Boolean(
    target &&
      typeof (target as Element).closest === "function" &&
      (target as Element).closest(`[${MAIN_AUDIO_DROP_TARGET_ATTRIBUTE}]`),
  );
}
