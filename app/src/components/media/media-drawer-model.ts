import type { MediaItem } from "../../media";

export type MediaDrawerView = "icons" | "list";

// Sessions lists the Sessions library; Media lists the linked media; Record
// sets the default record inputs.
export type MediaDrawerTab = "sessions" | "media" | "record";

export type MediaDrawerPrefs = {
  open: boolean;
  width: number;
  tab: MediaDrawerTab;
  view: MediaDrawerView;
  // The slider's value: the icon view's tile width in pixels. The list view
  // derives its icon size from it, see `getListIconSize`.
  thumbnailSize: number;
  // Whether the selected media's details pane is expanded.
  detailsOpen: boolean;
};

export const MEDIA_DRAWER_STORAGE_KEY = "zvid-media-drawer";
export const MEDIA_DRAWER_DEFAULT_WIDTH = 320;
export const MEDIA_DRAWER_MIN_WIDTH = 220;
// The widest the drawer gets before the editor has been measured.
export const MEDIA_DRAWER_FALLBACK_MAX_WIDTH = 560;
// The drawer takes at most this share of the editor's width.
export const MEDIA_DRAWER_MAX_FRACTION = 0.45;
export const MEDIA_DRAWER_RESIZE_KEY_STEP = 16;
export const THUMBNAIL_SIZE_MIN = 64;
export const THUMBNAIL_SIZE_MAX = 256;
export const THUMBNAIL_SIZE_DEFAULT = 112;
export const LIST_ICON_SIZE_MIN = 16;
export const LIST_ICON_SIZE_MAX = 48;

export const DEFAULT_MEDIA_DRAWER_PREFS: MediaDrawerPrefs = {
  open: false,
  width: MEDIA_DRAWER_DEFAULT_WIDTH,
  tab: "media",
  view: "icons",
  thumbnailSize: THUMBNAIL_SIZE_DEFAULT,
  detailsOpen: true,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getMediaDrawerMaxWidth(editorGridWidth: number) {
  if (!editorGridWidth) {
    return MEDIA_DRAWER_FALLBACK_MAX_WIDTH;
  }
  return Math.max(
    MEDIA_DRAWER_MIN_WIDTH,
    Math.floor(editorGridWidth * MEDIA_DRAWER_MAX_FRACTION),
  );
}

export function clampMediaDrawerWidth(width: number, maxWidth: number) {
  return Math.round(clamp(width, MEDIA_DRAWER_MIN_WIDTH, maxWidth));
}

export function clampThumbnailSize(size: number) {
  return Math.round(clamp(size, THUMBNAIL_SIZE_MIN, THUMBNAIL_SIZE_MAX));
}

// Maps the slider's 64–256px tile range onto the list view's 16–48px icons.
export function getListIconSize(thumbnailSize: number) {
  const fraction =
    (clampThumbnailSize(thumbnailSize) - THUMBNAIL_SIZE_MIN) /
    (THUMBNAIL_SIZE_MAX - THUMBNAIL_SIZE_MIN);
  return Math.round(
    LIST_ICON_SIZE_MIN + fraction * (LIST_ICON_SIZE_MAX - LIST_ICON_SIZE_MIN),
  );
}

// A click on the toolbar's Sessions | Media | Record switch: the drawer's open tab closes
// it, any other tab opens the drawer on that tab.
export function selectMediaDrawerTab(
  prefs: MediaDrawerPrefs,
  tab: MediaDrawerTab,
): MediaDrawerPrefs {
  if (prefs.open && prefs.tab === tab) {
    return { ...prefs, open: false };
  }
  return { ...prefs, open: true, tab };
}

// Reads stored prefs, falling back field by field so one bad value does not
// reset the rest.
export function parseMediaDrawerPrefs(
  stored: string | null | undefined,
): MediaDrawerPrefs {
  let value: Partial<Record<keyof MediaDrawerPrefs, unknown>> = {};
  try {
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (parsed && typeof parsed === "object") {
      value = parsed;
    }
  } catch {
    // Corrupt prefs read as the defaults.
  }

  const defaults = DEFAULT_MEDIA_DRAWER_PREFS;
  return {
    open: typeof value.open === "boolean" ? value.open : defaults.open,
    width:
      typeof value.width === "number" && Number.isFinite(value.width)
        ? clampMediaDrawerWidth(value.width, Number.POSITIVE_INFINITY)
        : defaults.width,
    tab:
      value.tab === "sessions" ||
      value.tab === "media" ||
      value.tab === "record"
        ? value.tab
        : defaults.tab,
    view:
      value.view === "list" || value.view === "icons"
        ? value.view
        : defaults.view,
    thumbnailSize:
      typeof value.thumbnailSize === "number" &&
      Number.isFinite(value.thumbnailSize)
        ? clampThumbnailSize(value.thumbnailSize)
        : defaults.thumbnailSize,
    detailsOpen:
      typeof value.detailsOpen === "boolean"
        ? value.detailsOpen
        : defaults.detailsOpen,
  };
}

// Case-insensitive match on the name, ignoring surrounding whitespace.
export function filterMediaItems<T extends Pick<MediaItem, "name">>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return [...items];
  }
  return items.filter((item) => item.name.toLocaleLowerCase().includes(needle));
}

// "3 items", or "1 of 3 items" while a search narrows the list.
export function formatMediaItemCount(
  shown: number,
  total: number,
  searching: boolean,
) {
  const noun = total === 1 ? "item" : "items";
  return searching ? `${shown} of ${total} ${noun}` : `${total} ${noun}`;
}

// Shortens a name by dropping characters from its middle, as Finder does, so
// both the start and the end (often a timestamp or extension) stay readable.
export function middleEllipsis(name: string, maxChars: number) {
  const chars = Array.from(name);
  if (chars.length <= maxChars) {
    return name;
  }
  if (maxChars <= 1) {
    return "…";
  }
  const kept = maxChars - 1;
  const head = Math.ceil(kept / 2);
  const tail = kept - head;
  return `${chars.slice(0, head).join("")}…${tail ? chars.slice(-tail).join("") : ""}`;
}

// How many characters of a name fit on two lines under a tile this wide.
export function getTileNameMaxChars(tileWidth: number) {
  return Math.max(8, Math.floor((tileWidth / 6.4) * 2));
}

export function describeMediaKind(
  item: Pick<MediaItem, "hasAudio" | "hasVideo" | "kind">,
) {
  if (item.kind === "image") {
    return "Image";
  }
  if (item.kind === "lut") {
    return "LUT";
  }
  const hasVideo = item.hasVideo || item.kind === "video";
  if (hasVideo && item.hasAudio) {
    return "Video + Audio";
  }
  return hasVideo ? "Video" : "Audio";
}

// "0:07", "1:05:09"; whole seconds, for badges and the list's Duration column.
export function formatMediaDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = (total % 60).toString().padStart(2, "0");
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

// The index a navigation key moves the selection to, or undefined for keys
// that don't navigate. `columns` is how many items a row holds: 1 in the list
// view, the grid's column count in the icon view.
export function getNextMediaIndex(
  key: string,
  index: number,
  count: number,
  columns: number,
): number | undefined {
  if (count === 0) {
    return undefined;
  }
  const last = count - 1;
  if (index < 0) {
    return key === "End" ? last : 0;
  }
  const step = Math.max(1, columns);
  switch (key) {
    case "ArrowRight":
      return Math.min(last, index + 1);
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowDown":
      return Math.min(last, index + step);
    case "ArrowUp":
      return Math.max(0, index - step);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return undefined;
  }
}
