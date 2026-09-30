// Where the hydration effect reads a project media item's bytes from: the
// media cache, then, for a bundled sample's asset, its same-origin URL (so
// an evicted sample asset is downloaded again rather than going offline),
// then the harness, from the item's source path or URL.

import { getHarness } from "../harness";
import type { MediaItem } from "../media";
import { getCachedMediaBlob } from "../media-cache";
import { downloadSampleAsset, sha256Hex } from "../sample/sample-loader.ts";
import { findSampleAsset } from "../sample/sample-manifest.ts";
import { SAMPLE_MANIFESTS } from "../sample/samples.ts";

// Undefined when there is nowhere to read the item from.
export async function readHydratableMedia(
  item: MediaItem,
): Promise<{ blob: Blob; cached: boolean } | undefined> {
  const cachedBlob = await getCachedMediaBlob(item.id);
  if (cachedBlob) {
    return { blob: cachedBlob, cached: true };
  }

  for (const manifest of SAMPLE_MANIFESTS) {
    const asset = findSampleAsset(manifest, item.sourcePath);
    if (asset) {
      const blob = await downloadSampleAsset(asset, {
        fetch: (url, init) => fetch(url, init),
        digest: sha256Hex,
      });
      return { blob, cached: false };
    }
  }

  if (!item.sourcePath && !item.previewUrl) {
    return undefined;
  }
  return { blob: await getHarness().readMediaBlob(item), cached: false };
}
