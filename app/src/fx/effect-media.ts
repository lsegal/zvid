// Finding the media an effect names by path, such as Shape ▸ Custom's SVG
// or a LUT's `.cube` file.

import type { MediaItem } from "../media.ts";

// As app/util's, which this can't import: the effect registry loads this,
// and app/util's constants load the registry.
function normalizeMediaPath(value: string) {
  return value.replaceAll("/", "\\").toLowerCase();
}

function basename(value: string) {
  return value.split(/[/\\]/).pop() ?? value;
}

// The path an effect stores for `item`, as a clip stores its media's.
export function effectMediaPath(item: Pick<MediaItem, "name" | "sourcePath">) {
  return item.sourcePath ?? item.name;
}

// The media `path` names, matched the way session clips match theirs: by
// full path, else by file name.
export function findEffectMedia<
  T extends Pick<MediaItem, "name" | "sourcePath">,
>(path: string | undefined, items: readonly T[]) {
  if (!path?.trim()) {
    return undefined;
  }
  const target = normalizeMediaPath(path.trim());
  const exact = items.find(
    (item) => item.sourcePath && normalizeMediaPath(item.sourcePath) === target,
  );
  if (exact) {
    return exact;
  }
  const name = basename(path.trim()).toLowerCase();
  return items.find((item) => item.name.toLowerCase() === name);
}
