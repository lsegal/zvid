// The asset manifest of a bundled sample project. The session template
// refers to each asset by a `zvid-sample://` path, which no disk or server
// resolves: the app maps it to the asset's stable id, and reads the bytes
// from the media cache or, failing that, the asset's same-origin URL. So the
// sample's media keeps its identity across save and reopen, and never needs
// locating.

import type { ServerMediaRef } from "../session.ts";

export type SampleAsset = {
  // The media id the asset is cached and referenced under.
  id: string;
  // The path the session template gives it.
  path: string;
  // Where the app serves it, same-origin.
  url: string;
  name: string;
  mediaType: string;
  bytes: number;
  // Hex SHA-256 of the file, checked after every download.
  sha256: string;
  credit: string;
};

export type SampleManifest = {
  id: string;
  // Bumped whenever an asset changes, so new bytes get new ids.
  version: string;
  sessionName: string;
  creditsUrl: string;
  assets: SampleAsset[];
};

export const SAMPLE_PATH_PREFIX = "zvid-sample://";

// A harness may treat a sample path as a file path on the way in: the dev
// server on Windows hands `zvid-sample://a/b` back as `.\zvid-sample:\a\b`.
// So sample paths are compared from their `zvid-sample:` marker, with
// forward slashes, runs of slashes collapsed, and case ignored.
function canonicalSamplePath(path: string) {
  const canonical = path
    .trim()
    .replace(/[\\/]+/g, "/")
    .toLowerCase();
  const marker = canonical.indexOf("zvid-sample:");
  return marker > 0 ? canonical.slice(marker) : canonical;
}

const CANONICAL_PREFIX = canonicalSamplePath(SAMPLE_PATH_PREFIX);

export function isSamplePath(path: string | undefined): path is string {
  return (
    path !== undefined && canonicalSamplePath(path).startsWith(CANONICAL_PREFIX)
  );
}

export function findSampleAsset(
  manifest: SampleManifest,
  path: string | undefined,
) {
  if (!isSamplePath(path)) {
    return undefined;
  }
  const canonical = canonicalSamplePath(path);
  return manifest.assets.find(
    (asset) => canonicalSamplePath(asset.path) === canonical,
  );
}

// `refs` with each sample asset under its stable id, whatever id the
// harness derived from its path, and marked missing so the media cache (or
// a fresh download) supplies it. Other refs are returned as they are.
export function resolveSampleMediaRefs(
  refs: ServerMediaRef[],
  manifests: readonly SampleManifest[],
): ServerMediaRef[] {
  return refs.map((ref) => {
    for (const manifest of manifests) {
      const asset = findSampleAsset(manifest, ref.path);
      if (asset) {
        return {
          id: asset.id,
          path: asset.path,
          name: asset.name,
          url: "",
          exists: false,
        };
      }
    }
    return ref;
  });
}
