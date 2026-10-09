import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPlaceDevice,
  getClearableDevices,
  getStackAtPoint,
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
function chain(clipScope: "clip" | "fxClip" = "clip") {
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
    mapSessionEffectsToDevices(
      effects,
      "1",
      "Layer 1",
      [],
      new Set(),
      CLIP,
      clipScope,
    ),
    undefined,
  );
}

describe("isFixedDevice", () => {
  it("fixes a layer's Layout and the clip's content effect", () => {
    const groups = chain();
    const fixed = [...groups.global, ...groups.layer, ...groups.clip]
      .filter((device) => isFixedDevice(device, "clip"))
      .map((device) => device.id);
    assert.deepEqual(fixed, ["layout-1", "text"]);
  });

  it("fixes nothing on an FX clip's stack", () => {
    const device = { effectName: "Color", group: "clip" } as const;
    assert.equal(isFixedDevice(device, "fxClip"), false);
    assert.equal(isFixedDevice(device, "clip"), true);
    assert.equal(isFixedDevice({ ...device, group: "layer" }, "clip"), false);
  });
});

describe("canPlaceDevice", () => {
  it("follows the effect's scopes", () => {
    assert.equal(canPlaceDevice("Pixelate", "global", []), true);
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

describe("getStackAtPoint", () => {
  const dividers = [
    { group: "global", left: 100 },
    { group: "layer", left: 300 },
    { group: "clip", left: 500 },
  ] as const;

  it("finds the section a point falls in", () => {
    assert.equal(getStackAtPoint(dividers, 99), undefined);
    assert.equal(getStackAtPoint(dividers, 100), "global");
    assert.equal(getStackAtPoint(dividers, 299), "global");
    assert.equal(getStackAtPoint(dividers, 300), "layer");
    assert.equal(getStackAtPoint(dividers, 900), "clip");
  });
});

describe("getClearableDevices", () => {
  it("leaves Global devices, the Layout and the clip's content", () => {
    assert.deepEqual(
      getClearableDevices(chain(), "clip").map((device) => device.id),
      ["pixelate", "gain"],
    );
  });

  it("clears an FX clip's whole stack", () => {
    assert.deepEqual(
      getClearableDevices(chain("fxClip"), "fxClip").map((device) => device.id),
      ["pixelate", "text", "gain"],
    );
  });
});
