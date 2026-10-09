import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPlaceDevice,
  getClearableDevices,
  groupChainDevices,
  isFixedDevice,
} from "./fx-chain.ts";
import {
  clipEffectTrackId,
  createEffect,
  ensureLayerLayouts,
  GLOBAL_EFFECT_TRACK_ID,
  mapSessionEffectsToDevices,
} from "./fx-stack.ts";

const CLIP = clipEffectTrackId("c1");

// Layer 1 with its Layout and a Pixelate, a Global Order, and a text clip
// with its Text and a Gain.
function chain() {
  const effects = ensureLayerLayouts(
    [
      createEffect(GLOBAL_EFFECT_TRACK_ID, "Order", "order"),
      createEffect("1", "Pixelate", "pixelate"),
      createEffect(CLIP, "Text", "text"),
      createEffect(CLIP, "Gain", "gain"),
    ],
    ["1"],
  );
  return groupChainDevices(
    mapSessionEffectsToDevices(effects, "1", "Layer 1", [], new Set(), CLIP),
    undefined,
  );
}

describe("isFixedDevice", () => {
  it("fixes a layer's Layout and the clip's content effect", () => {
    const groups = chain();
    const fixed = [...groups.global, ...groups.layer, ...groups.clip]
      .filter((device) => isFixedDevice(device))
      .map((device) => device.id);
    assert.deepEqual(fixed, ["layout-1", "text"]);
  });

  it("leaves content effects on a layer's stack free", () => {
    assert.equal(isFixedDevice({ effectName: "Color", group: "clip" }), true);
    assert.equal(isFixedDevice({ effectName: "Color", group: "layer" }), false);
  });
});

describe("canPlaceDevice", () => {
  it("follows the effect's scopes", () => {
    assert.equal(canPlaceDevice("Pixelate", "global", []), true);
    assert.equal(canPlaceDevice("Transform", "global", []), false);
    assert.equal(canPlaceDevice("Order", "layer", []), false);
    assert.equal(canPlaceDevice("Order", "fxClip", []), true);
    assert.equal(canPlaceDevice("Reverse", "global", []), false);
    assert.equal(canPlaceDevice("Reverse", "clip", []), true);
    assert.equal(canPlaceDevice("Text", "layer", []), false);
  });

  it("keeps one Layout per layer", () => {
    assert.equal(canPlaceDevice("Layout", "layer", []), true);
    assert.equal(
      canPlaceDevice("Layout", "layer", [{ effectName: "Layout" }]),
      false,
    );
  });
});

describe("getClearableDevices", () => {
  it("leaves Global devices, the Layout and the clip's content", () => {
    assert.deepEqual(
      getClearableDevices(chain()).map((device) => device.id),
      ["pixelate", "gain"],
    );
  });
});
