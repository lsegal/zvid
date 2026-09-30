import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDENTITY_TRANSFORM } from "../../../composition-transform.ts";
import { parseLayerTransform } from "./transform.ts";

describe("parseLayerTransform", () => {
  it("reads each key exactly and clamps it to its range", () => {
    assert.deepEqual(
      parseLayerTransform([
        { key: "PositionX", value: "0.25", numericValue: 0.25 },
        { key: "PositionY", value: "-3" },
        { key: "ScaleX", value: "2", numericValue: 2 },
        { key: "ScaleY", value: "0", numericValue: 0 },
        { key: "OriginX", value: "-1", numericValue: -1 },
        { key: "OriginY", value: "0.5", numericValue: 0.5 },
        { key: "Rotation", value: "270", numericValue: 270 },
      ]),
      {
        positionX: 0.25,
        positionY: -2,
        scaleX: 2,
        scaleY: 0.05,
        originX: -1,
        originY: 0.5,
        rotationDeg: 180,
      },
    );
  });

  it("keeps identity defaults for missing or unreadable values", () => {
    assert.deepEqual(
      parseLayerTransform([
        { key: "ScaleX", value: "wide" },
        { key: "Opacity", value: "0.5", numericValue: 0.5 },
      ]),
      IDENTITY_TRANSFORM,
    );
  });
});
