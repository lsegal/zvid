// Where the hydration effect reads a project media item's bytes from: the
// media cache, then the harness, from the item's source path or URL. A
// bundled sample's assets are downloaded by useSampleMedia instead, so
// their progress shows like media syncing from a peer.

import { getHarness } from "../harness";
import type { MediaItem } from "../media";
import { getCachedMediaBlob } from "../media-cache";
import { findBundledSampleAsset } from "../sample/samples.ts";

export function isSampleMediaItem(item: Pick<MediaItem, "sourcePath">) {
  return findBundledSampleAsset(item.sourcePath) !== undefined;
}

// Undefined when there is nowhere to read the item from.
export async function readHydratableMedia(
  item: MediaItem,
): Promise<{ blob: Blob; cached: boolean } | undefined> {
  const cachedBlob = await getCachedMediaBlob(item.id);
  if (cachedBlob) {
    return { blob: cachedBlob, cached: true };
  }

  if (!item.sourcePath && !item.previewUrl) {
    return undefined;
  }
  return { blob: await getHarness().readMediaBlob(item), cached: false };
}
