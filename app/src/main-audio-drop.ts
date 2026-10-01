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

/**
 * `accept`: files that may be audio are dragged; `reject`: files, but all are
 * known not to be audio.
 */
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
 * MIME types browsers report for files whose real type they could not detect.
 * An item with one of these may still be audio, so it is never rejected.
 */
const UNKNOWN_MIME_TYPES = ["", "application/octet-stream"];

/** Whether a dragged item's MIME type is known and clearly not audio. */
function isKnownNonAudioType(type: string) {
  return !UNKNOWN_MIME_TYPES.includes(type) && !type.startsWith("audio/");
}

/**
 * Classifies an in-progress drag over the Audio lane. During `dragover`
 * browsers hide file names and often report an empty MIME type (for example
 * for `.flac` or `.aiff`), and Safari may expose only `types: ["Files"]`, so
 * any file drag is accepted unless every item has a known non-audio type. The
 * drop itself is validated with `getDroppedAudioFile`.
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
    return fileItems.every((item) => isKnownNonAudioType(item.type))
      ? "reject"
      : "accept";
  }

  return Array.from(dataTransfer.types).includes("Files") ? "accept" : "none";
}

/**
 * Whether a drag event target lies within the Audio lane. Text nodes, which
 * have no `closest`, are resolved through their parent element.
 */
export function isWithinMainAudioDropTarget(target: EventTarget | null) {
  const element =
    target && typeof (target as Element).closest === "function"
      ? (target as Element)
      : ((target as Node | null)?.parentElement ?? null);
  return Boolean(
    element?.closest(`[${MAIN_AUDIO_DROP_TARGET_ATTRIBUTE}]`),
  );
}
