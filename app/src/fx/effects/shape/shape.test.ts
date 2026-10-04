import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRANSFORM_EFFECT_NAME } from "../../../composition-transform.ts";
import {
  addEffect,
  clipEffectTrackId,
  type SessionEffect,
  setEffectParameter,
} from "../../../fx-stack.ts";
import {
  addShapeTransform,
  findLayerTransform,
  readLayerTransform,
} from "../../../preview-edit.ts";
import { defaultShapeScale, SHAPE_EFFECT_NAME } from "./shape.ts";

const CANVAS = { width: 1920, height: 1080 };

function withShape(trackId: string) {
  return addEffect([], trackId, SHAPE_EFFECT_NAME, undefined, "shape");
}

describe("defaultShapeScale", () => {
  it("makes a square half the canvas height across", () => {
    for (const canvas of [CANVAS, { width: 1080, height: 1920 }]) {
      const { scaleX, scaleY } = defaultShapeScale(canvas.width, canvas.height);
      assert.ok(Math.abs(scaleX * canvas.width - canvas.height / 2) < 1e-9);
      assert.equal(scaleY * canvas.height, canvas.height / 2);
    }
  });

  it("keeps a square box for an unsized canvas", () => {
    assert.deepEqual(defaultShapeScale(0, 0), { scaleX: 0.5, scaleY: 0.5 });
  });
});

describe("addShapeTransform", () => {
  it("adds a centered square Transform to a layer without one", () => {
    const next = addShapeTransform(withShape("a"), "a", CANVAS, "t");
    const transform = findLayerTransform(next, "a");
    assert.equal(transform?.id, "t");
    assert.equal(transform?.enabled, true);
    assert.equal(transform?.animation?.enabled, false);
    const read = readLayerTransform(next, "a");
    assert.equal(read.positionX, 0);
    assert.equal(read.positionY, 0);
    assert.equal(read.rotationDeg, 0);
    assert.equal(read.scaleY, 0.5);
    assert.ok(Math.abs(read.scaleX - 0.28125) < 1e-9);
  });

  it("works on a clip's own stack", () => {
    const trackId = clipEffectTrackId("c");
    const next = addShapeTransform(withShape(trackId), trackId, CANVAS, "t");
    assert.equal(readLayerTransform(next, trackId).scaleY, 0.5);
  });

  it("leaves an existing Transform as it is", () => {
    let effects: SessionEffect[] = addEffect(
      withShape("a"),
      "a",
      TRANSFORM_EFFECT_NAME,
      undefined,
      "existing",
    );
    effects = setEffectParameter(effects, "existing", "ScaleX", 2);
    const next = addShapeTransform(effects, "a", CANVAS, "t");
    assert.equal(next, effects);
    assert.equal(readLayerTransform(next, "a").scaleX, 2);
  });

  it("ignores another layer's Transform", () => {
    const effects = addEffect(
      withShape("a"),
      "b",
      TRANSFORM_EFFECT_NAME,
      undefined,
      "other",
    );
    const next = addShapeTransform(effects, "a", CANVAS, "t");
    assert.equal(findLayerTransform(next, "a")?.id, "t");
  });
});
