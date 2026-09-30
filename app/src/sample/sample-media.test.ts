import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { OPENING_SAMPLE_MANIFEST } from "./opening-manifest.generated.ts";
import { findBundledSampleAsset } from "./samples.ts";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const appTsx = read("../App.tsx");
const appDialogsTsx = read("../components/AppDialogs.tsx");
const useSampleProjectTs = read("../hooks/useSampleProject.ts");
const useSampleMediaTs = read("../hooks/useSampleMedia.ts");
const mediaHydrationTs = read("../app/media-hydration.ts");
const useMediaHydrationTs = read("../hooks/useMediaHydration.ts");

describe("sample media loading", () => {
  it("finds a bundled asset by its sample path only", () => {
    const [asset] = OPENING_SAMPLE_MANIFEST.assets;
    assert.equal(findBundledSampleAsset(asset.path)?.id, asset.id);
    assert.equal(findBundledSampleAsset(asset.url), undefined);
    assert.equal(findBundledSampleAsset(undefined), undefined);
  });

  it("has no separate loading screen", () => {
    assert.equal(
      existsSync(
        new URL("../components/SampleLoadDialog.tsx", import.meta.url),
      ),
      false,
    );
    assert.doesNotMatch(
      appTsx + appDialogsTsx,
      /SampleLoadDialog|sample\.dialog/,
    );
    assert.doesNotMatch(useSampleProjectTs, /loadSampleAssets|Dialog/);
    assert.match(
      useSampleProjectTs,
      /openSamplePayload\(\s*buildSampleOpenPayload\(manifest, sessionText\)/,
    );
  });

  it("downloads sample media into the shared progress model", () => {
    assert.match(useSampleMediaTs, /loadSampleAssets\(wanted,/);
    assert.match(useSampleMediaTs, /source: "url",\s*phase: "queued"/);
    assert.match(useSampleMediaTs, /source: "url",\s*phase: "receiving"/);
    assert.match(
      useSampleMediaTs,
      /withoutRemoteMediaProgress\(map, mediaId\)/,
    );
    assert.match(useSampleMediaTs, /adoptMediaBlob\(mediaId, blob\)/);
    assert.match(useSampleMediaTs, /setFailedSampleMediaIds\(/);
  });

  it("leaves sample media to useSampleMedia, ahead of peer requests", () => {
    assert.doesNotMatch(mediaHydrationTs, /downloadSampleAsset/);
    assert.match(
      useMediaHydrationTs,
      /mediaHydrationInFlightRef\.current\.has\(item\.id\) \|\|\s*isSampleMediaItem\(item\)/,
    );
    assert.match(useMediaHydrationTs, /return useSampleMedia\(\{/);
    const sampleMedia = appTsx.indexOf("useMediaHydration({");
    const peerMedia = appTsx.indexOf("usePeerMedia({");
    assert.ok(sampleMedia > 0 && sampleMedia < peerMedia);
    assert.match(
      appDialogsTsx,
      /retrySampleMedia\(mediaId\);\s*retryPeerMedia\(mediaId\);/,
    );
  });
});
