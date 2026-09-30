// The samples bundled with the app, by manifest. Kept free of the session
// templates, so resolving sample media doesn't pull them in.

import { OPENING_SAMPLE_MANIFEST } from "./opening-manifest.generated.ts";
import { findSampleAsset, type SampleManifest } from "./sample-manifest.ts";

export const SAMPLE_MANIFESTS: readonly SampleManifest[] = [
  OPENING_SAMPLE_MANIFEST,
];

// The bundled sample asset at `path`, if any.
export function findBundledSampleAsset(path: string | undefined) {
  for (const manifest of SAMPLE_MANIFESTS) {
    const asset = findSampleAsset(manifest, path);
    if (asset) {
      return asset;
    }
  }
  return undefined;
}
