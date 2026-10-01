/**
 * Dragging media items from the Media drawer within the app. The drag carries
 * the media ids under its own MIME type, so drop targets can tell it from
 * files dragged in from the OS.
 */

export const MEDIA_DRAG_TYPE = "application/x-zvid-media";

type DataTransferLike = {
  types: ArrayLike<string>;
  getData?: (format: string) => string;
};

// Browsers hide drag data until drop, so the ids being dragged are also kept
// here for the drop targets' previews while the drag is in progress.
let activeMediaIds: string[] = [];

export function startMediaDrag(
  dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">,
  mediaIds: string[],
) {
  dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(mediaIds));
  dataTransfer.effectAllowed = "copy";
  activeMediaIds = [...mediaIds];
}

export function endMediaDrag() {
  activeMediaIds = [];
}

export function isMediaDrag(dataTransfer: DataTransferLike | null) {
  return (
    !!dataTransfer && Array.from(dataTransfer.types).includes(MEDIA_DRAG_TYPE)
  );
}

function parseMediaIds(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && !!id)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The media ids an in-app drag carries: its payload once it is readable (on
 * drop), or the ids the drag started with while it is hidden.
 */
export function getDraggedMediaIds(dataTransfer: DataTransferLike | null) {
  if (!isMediaDrag(dataTransfer)) {
    return [];
  }
  return (
    parseMediaIds(dataTransfer?.getData?.(MEDIA_DRAG_TYPE)) ?? [
      ...activeMediaIds,
    ]
  );
}
