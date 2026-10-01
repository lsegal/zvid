import { normalizeMediaPath } from "./app/util.ts";
import type { MediaItem } from "./media.ts";
import { snapFrameRate } from "./session-format.ts";

// The part of a media item to use when it goes into the timeline, in seconds
// from the start of the file. A media item without one uses the whole file.
export type MediaRange = {
  inSeconds: number;
  outSeconds: number;
};

export type MediaRangePoint = "in" | "out";

export const MEDIA_RANGE_HISTORY_LABELS = {
  in: "Set media in point",
  out: "Set media out point",
  clear: "Clear media in/out points",
} as const;

const DEFAULT_FRAME_RATE = 30;

// Frame-rate jitter in seconds that still counts as the same frame.
const FRAME_EPSILON = 1e-6;

// The standard rate near `fps`, or the nearest whole rate within half a
// percent (15 fps, which is not a standard rate), or `fps` itself.
function nominalFrameRate(fps: number) {
  const snapped = snapFrameRate(fps);
  // Without a standard rate nearby, `snapFrameRate` only rounds.
  if (snapped !== Math.round(fps * 1000) / 1000) {
    return snapped;
  }
  const whole = Math.round(fps);
  return Math.abs(fps - whole) <= whole * 0.005 ? whole : snapped;
}

// Media snaps to its own frames, or the project's when it has none (audio).
export function mediaRangeFrameRate(
  item: Pick<MediaItem, "fps">,
  projectFps: number,
) {
  // A probed rate is measured, so 29.97 can read as 29.9701; points must
  // land on the nominal frames the readout counts.
  if (item.fps && item.fps > 0) {
    return nominalFrameRate(item.fps);
  }
  return projectFps > 0 ? projectFps : DEFAULT_FRAME_RATE;
}

export function snapSecondsToFrame(seconds: number, fps: number) {
  return Math.round(seconds * fps) / fps;
}

// The range stored on the item, or `undefined` when it has none or the stored
// values are not a usable range.
export function mediaRangeOf(
  item: Pick<MediaItem, "rangeInSeconds" | "rangeOutSeconds">,
): MediaRange | undefined {
  const { rangeInSeconds, rangeOutSeconds } = item;
  if (
    typeof rangeInSeconds !== "number" ||
    typeof rangeOutSeconds !== "number" ||
    !Number.isFinite(rangeInSeconds) ||
    !Number.isFinite(rangeOutSeconds) ||
    rangeInSeconds < 0 ||
    rangeOutSeconds <= rangeInSeconds
  ) {
    return undefined;
  }
  return { inSeconds: rangeInSeconds, outSeconds: rangeOutSeconds };
}

export function hasMediaRange(item: MediaItem) {
  return mediaRangeOf(item) !== undefined;
}

// The range to use for the item: its own, or the whole file.
export function effectiveMediaRange(item: MediaItem): MediaRange {
  return (
    mediaRangeOf(item) ?? {
      inSeconds: 0,
      outSeconds: Math.max(0, item.durationSeconds),
    }
  );
}

// Keeps `0 <= in < out <= duration`, at least one frame apart, with both
// points on a frame. The point being moved wins: the other one moves to keep
// the range valid. Returns `undefined` when the media is shorter than a frame.
export function normalizeMediaRange(
  range: MediaRange,
  durationSeconds: number,
  fps: number,
  moved: MediaRangePoint = "in",
): MediaRange | undefined {
  const frame = 1 / fps;
  if (!(durationSeconds + FRAME_EPSILON >= frame)) {
    return undefined;
  }
  // The last whole frame that fits, so a snapped Out never passes the end.
  const end = Math.floor((durationSeconds + FRAME_EPSILON) * fps) / fps;
  const snap = (seconds: number) =>
    Math.min(end, Math.max(0, snapSecondsToFrame(seconds, fps)));

  let inSeconds = snap(range.inSeconds);
  let outSeconds = snap(range.outSeconds);
  if (outSeconds - inSeconds < frame - FRAME_EPSILON) {
    if (moved === "in") {
      inSeconds = Math.min(inSeconds, end - frame);
      outSeconds = inSeconds + frame;
    } else {
      outSeconds = Math.max(outSeconds, frame);
      inSeconds = outSeconds - frame;
    }
    inSeconds = snapSecondsToFrame(inSeconds, fps);
    outSeconds = snapSecondsToFrame(outSeconds, fps);
  }
  return { inSeconds, outSeconds };
}

export function withMediaRange(
  item: MediaItem,
  range: MediaRange | undefined,
): MediaItem {
  const { rangeInSeconds: _in, rangeOutSeconds: _out, ...rest } = item;
  return range
    ? {
        ...rest,
        rangeInSeconds: range.inSeconds,
        rangeOutSeconds: range.outSeconds,
      }
    : rest;
}

// Sets one point at `seconds`. Without a range yet, the other point starts at
// the matching end of the file.
export function setMediaRangePoint(
  item: MediaItem,
  point: MediaRangePoint,
  seconds: number,
  projectFps: number,
): MediaItem {
  const current = effectiveMediaRange(item);
  const next = normalizeMediaRange(
    point === "in"
      ? { ...current, inSeconds: seconds }
      : { ...current, outSeconds: seconds },
    item.durationSeconds,
    mediaRangeFrameRate(item, projectFps),
    point,
  );
  if (!next) {
    return item;
  }
  const previous = mediaRangeOf(item);
  if (
    previous &&
    previous.inSeconds === next.inSeconds &&
    previous.outSeconds === next.outSeconds
  ) {
    return item;
  }
  return withMediaRange(item, next);
}

export function clearMediaRange(item: MediaItem): MediaItem {
  return item.rangeInSeconds === undefined && item.rangeOutSeconds === undefined
    ? item
    : withMediaRange(item, undefined);
}

// Applies `update` to the item with `id`. Returns `items` itself when nothing
// changed, so a history commit with it is a no-op.
export function updateMediaItem(
  items: MediaItem[],
  id: string,
  update: (item: MediaItem) => MediaItem,
) {
  let changed = false;
  const next = items.map((item) => {
    if (item.id !== id) {
      return item;
    }
    const updated = update(item);
    changed ||= updated !== item;
    return updated;
  });
  return changed ? next : items;
}

// Keeps the ranges of `current` items when `incoming` copies of them, such as
// freshly analyzed media, replace them.
export function keepMediaRange(current: MediaItem, incoming: MediaItem) {
  return withMediaRange(incoming, mediaRangeOf(current));
}

export type SavedMediaRange = {
  path: string;
  inSeconds: number;
  outSeconds: number;
};

function mediaRangeKey(item: Pick<MediaItem, "name" | "sourcePath">) {
  return item.sourcePath ?? item.name;
}

export function savedMediaRanges(
  items: ReadonlyArray<
    Pick<
      MediaItem,
      "name" | "sourcePath" | "rangeInSeconds" | "rangeOutSeconds"
    >
  >,
): SavedMediaRange[] {
  return items.flatMap((item) => {
    const range = mediaRangeOf(item);
    return range ? [{ path: mediaRangeKey(item), ...range }] : [];
  });
}

// Puts the saved ranges back on the media they were saved for. Media opens
// before it is analyzed, so the ranges are only checked for being in order.
export function restoreMediaRanges(
  items: MediaItem[],
  saved: readonly SavedMediaRange[] | undefined,
): MediaItem[] {
  if (!saved?.length) {
    return items;
  }
  const byPath = new Map(
    saved.map((range) => [normalizeMediaPath(range.path), range]),
  );
  return items.map((item) => {
    const range = byPath.get(normalizeMediaPath(mediaRangeKey(item)));
    if (!range) {
      return item;
    }
    const restored = withMediaRange(item, {
      inSeconds: range.inSeconds,
      outSeconds: range.outSeconds,
    });
    return mediaRangeOf(restored) ? restored : item;
  });
}
