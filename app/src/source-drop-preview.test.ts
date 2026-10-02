import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaItem } from "./media.ts";
import {
  getSourceDropPreviewItems,
  getSourceDropPreviewLayout,
  getSourceDropPreviewThumbnailRequests,
} from "./source-drop-preview.ts";

// At 120 BPM a quarter lasts half a second.
const BPM = 120;

function media(
  id: string,
  durationSeconds: number,
  range?: { inSeconds: number; outSeconds: number },
  options: Partial<MediaItem> = {},
): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    durationSeconds,
    hasAudio: true,
    hasVideo: true,
    color: "#111",
    accent: "#222",
    previewUrl: `blob:${id}`,
    availability: "ready",
    ...(range
      ? { rangeInSeconds: range.inSeconds, rangeOutSeconds: range.outSeconds }
      : {}),
    ...options,
  };
}

describe("getSourceDropPreviewItems", () => {
  it("trims each item to its In/Out range, like the drop", () => {
    assert.deepEqual(
      getSourceDropPreviewItems([
        media("a", 3, { inSeconds: 1, outSeconds: 2.5 }),
      ]),
      [
        {
          mediaId: "a",
          label: "a",
          kind: "video",
          inSeconds: 1,
          durationSeconds: 1.5,
        },
      ],
    );
  });

  it("uses the whole file without a range", () => {
    const [item] = getSourceDropPreviewItems([media("a", 3)]);
    assert.equal(item?.inSeconds, 0);
    assert.equal(item?.durationSeconds, 3);
  });
});

describe("getSourceDropPreviewLayout", () => {
  it("spans the range's length at the current zoom from the drop position", () => {
    const items = getSourceDropPreviewItems([
      media("a", 3, { inSeconds: 1, outSeconds: 2 }),
    ]);
    // One second is two quarters.
    assert.deepEqual(getSourceDropPreviewLayout(items, 12, BPM, 40), {
      leftPx: 480,
      widthPx: 80,
      segments: [{ leftPx: 0, widthPx: 80 }],
    });
    // Zooming in widens it.
    assert.equal(getSourceDropPreviewLayout(items, 12, BPM, 80).widthPx, 160);
    // A faster tempo fits more quarters in the same second.
    assert.equal(getSourceDropPreviewLayout(items, 12, 240, 40).widthPx, 160);
  });

  it("spans several items back to back, marking each one", () => {
    const items = getSourceDropPreviewItems([
      media("a", 3, { inSeconds: 1, outSeconds: 2 }),
      media("b", 2),
      media("c", 4, { inSeconds: 0.5, outSeconds: 1 }),
    ]);
    // One, two and half a second: two, four and one quarters from 3.
    assert.deepEqual(getSourceDropPreviewLayout(items, 3, BPM, 10), {
      leftPx: 30,
      widthPx: 70,
      segments: [
        { leftPx: 0, widthPx: 20 },
        { leftPx: 20, widthPx: 40 },
        { leftPx: 60, widthPx: 10 },
      ],
    });
  });
});

describe("getSourceDropPreviewThumbnailRequests", () => {
  it("asks for the frame at each video item's In point", () => {
    const a = media("a", 3, { inSeconds: 1, outSeconds: 2 });
    const tone = media("tone", 3, undefined, {
      kind: "audio",
      hasVideo: false,
    });
    const offline = media("offline", 3, undefined, {
      availability: "offline",
      previewUrl: "",
    });
    const items = getSourceDropPreviewItems([a, tone, offline]);
    const requests = getSourceDropPreviewThumbnailRequests(
      items,
      new Map([a, tone, offline].map((item) => [item.id, item])),
    );
    assert.deepEqual(
      requests.map(({ key, owner, timeSeconds, sourceUrl }) => ({
        key,
        owner,
        timeSeconds,
        sourceUrl,
      })),
      [
        {
          key: "a:1.000",
          owner: "drop-preview:0",
          timeSeconds: 1,
          sourceUrl: "blob:a",
        },
      ],
    );
  });
});
