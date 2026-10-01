import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  endMediaDrag,
  getDraggedMediaIds,
  isMediaDrag,
  MEDIA_DRAG_TYPE,
  startMediaDrag,
} from "./media-drag.ts";

// A DataTransfer that, like browsers before drop, can hide its data.
function dataTransfer({ hidden = false } = {}) {
  const data = new Map<string, string>();
  return {
    effectAllowed: "uninitialized" as DataTransfer["effectAllowed"],
    get types() {
      return Array.from(data.keys());
    },
    setData(format: string, value: string) {
      data.set(format, value);
    },
    getData(format: string) {
      return hidden ? "" : (data.get(format) ?? "");
    },
  };
}

describe("media drag", () => {
  afterEach(endMediaDrag);

  it("carries the media ids under its own type", () => {
    const transfer = dataTransfer();
    startMediaDrag(transfer, ["a", "b"]);
    assert.deepEqual(transfer.types, [MEDIA_DRAG_TYPE]);
    assert.equal(transfer.effectAllowed, "copy");
    assert.equal(isMediaDrag(transfer), true);
    assert.deepEqual(getDraggedMediaIds(transfer), ["a", "b"]);
  });

  it("knows the ids while the browser hides the data", () => {
    const transfer = dataTransfer({ hidden: true });
    startMediaDrag(transfer, ["a"]);
    assert.deepEqual(getDraggedMediaIds(transfer), ["a"]);
  });

  it("is not a file drag from the OS", () => {
    const files = { types: ["Files"], getData: () => "" };
    assert.equal(isMediaDrag(files), false);
    assert.deepEqual(getDraggedMediaIds(files), []);
    assert.equal(isMediaDrag(null), false);
  });

  it("forgets the ids once the drag ends", () => {
    const transfer = dataTransfer({ hidden: true });
    startMediaDrag(transfer, ["a"]);
    endMediaDrag();
    assert.deepEqual(getDraggedMediaIds(transfer), []);
  });

  it("ignores a payload that is not a list of ids", () => {
    const transfer = {
      types: [MEDIA_DRAG_TYPE],
      getData: () => '{"id":"a"}',
    };
    assert.deepEqual(getDraggedMediaIds(transfer), []);
    const mixed = {
      types: [MEDIA_DRAG_TYPE],
      getData: () => '["a", 3, ""]',
    };
    assert.deepEqual(getDraggedMediaIds(mixed), ["a"]);
  });
});
