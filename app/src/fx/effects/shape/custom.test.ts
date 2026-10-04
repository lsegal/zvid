import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaItem } from "../../../media.ts";
import {
  findShapeMedia,
  getShapeImageMedia,
  isShapeSvgReady,
  setShapeImageMedia,
  shapeMediaPath,
  subscribeShapeImages,
} from "./custom-mask.ts";
import { customShapeMediaPaths } from "./shape.ts";
import {
  custom,
  customShapeMediaPath,
  customShapeValue,
} from "./shapes/custom.ts";
import { findShape } from "./shapes/index.ts";

function media(
  overrides: Partial<MediaItem> & Pick<MediaItem, "id" | "name" | "kind">,
): MediaItem {
  return {
    durationSeconds: 0,
    hasAudio: false,
    hasVideo: false,
    color: "#000",
    accent: "#fff",
    previewUrl: "",
    availability: "ready",
    ...overrides,
  };
}

describe("Custom shape values", () => {
  it("stores the SVG's media path after the name", () => {
    const value = customShapeValue("C:\\art\\logo.svg");
    assert.equal(value, "Custom:C:\\art\\logo.svg");
    assert.equal(customShapeMediaPath(value), "C:\\art\\logo.svg");
    assert.equal(findShape(value), custom);
  });

  it("reads no path from other shapes or a bare Custom", () => {
    assert.equal(customShapeMediaPath("Star"), undefined);
    assert.equal(customShapeMediaPath("Custom"), undefined);
    assert.equal(customShapeMediaPath("Custom:  "), undefined);
    assert.equal(customShapeMediaPath(undefined), undefined);
    assert.equal(findShape("Custom"), custom);
  });

  it("collects the SVGs of enabled Shape effects once each", () => {
    const shape = (value: string, enabled?: boolean) => ({
      effectName: "Shape",
      enabled,
      parameters: [{ key: "Shape", value }],
    });
    assert.deepEqual(
      customShapeMediaPaths([
        shape("Custom:a.svg"),
        shape("Custom:a.svg"),
        shape("Custom:b.svg", false),
        shape("Star"),
        {
          effectName: "Text",
          parameters: [{ key: "Shape", value: "Custom:c.svg" }],
        },
        shape("Custom:d.svg"),
      ]),
      ["a.svg", "d.svg"],
    );
  });
});

describe("Shape image media", () => {
  it("keeps only the session's image media and notifies on change", () => {
    let calls = 0;
    const unsubscribe = subscribeShapeImages(() => {
      calls++;
    });
    const items = [
      media({ id: "v", name: "clip.mp4", kind: "video", hasVideo: true }),
      media({ id: "s", name: "logo.svg", kind: "image" }),
    ];
    setShapeImageMedia(items);
    assert.deepEqual(
      getShapeImageMedia().map((item) => item.id),
      ["s"],
    );
    assert.equal(calls, 1);
    // The same media again changes nothing.
    setShapeImageMedia([...items]);
    assert.equal(calls, 1);
    unsubscribe();
    setShapeImageMedia([]);
  });

  it("finds media by full path, else by file name", () => {
    const items = [
      { ...media({ id: "a", name: "logo.svg", kind: "image" }) },
      {
        ...media({
          id: "b",
          name: "logo.svg",
          kind: "image",
          sourcePath: "/art/v2/logo.svg",
        }),
      },
    ];
    assert.equal(findShapeMedia("\\ART\\v2\\logo.svg", items)?.id, "b");
    assert.equal(findShapeMedia("/elsewhere/LOGO.svg", items)?.id, "a");
    assert.equal(findShapeMedia("other.svg", items), undefined);
    assert.equal(findShapeMedia("", items), undefined);
    assert.equal(shapeMediaPath(items[1]), "/art/v2/logo.svg");
    assert.equal(shapeMediaPath(items[0]), "logo.svg");
  });

  it("is not ready while the media is offline", () => {
    setShapeImageMedia([
      media({
        id: "s",
        name: "logo.svg",
        kind: "image",
        availability: "offline",
      }),
    ]);
    assert.equal(isShapeSvgReady("logo.svg"), false);
    setShapeImageMedia([]);
  });
});
