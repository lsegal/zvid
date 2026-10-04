import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findLayerMask,
  maskCoverage,
  parseLayerMask,
  pruneMaskTargets,
} from "./mask.ts";

function mask(
  trackId: string,
  target: string,
  mode = "Additive",
  enabled?: boolean,
) {
  return {
    trackId,
    effectName: "Mask",
    enabled,
    parameters: [
      { key: "Target", value: target },
      { key: "Mode", value: mode },
    ],
  };
}

describe("parseLayerMask", () => {
  it("reads the Target and Mode", () => {
    assert.deepEqual(parseLayerMask(mask("1", "2", "Subtractive").parameters), {
      targetLaneId: "2",
      mode: "subtractive",
    });
  });

  it("is Additive unless Subtractive", () => {
    assert.equal(
      parseLayerMask(mask("1", "2", "").parameters)?.mode,
      "additive",
    );
    assert.equal(
      parseLayerMask(mask("1", "2", "Bogus").parameters)?.mode,
      "additive",
    );
  });

  it("masks nothing without a Target", () => {
    assert.equal(parseLayerMask(mask("1", "").parameters), undefined);
    assert.equal(parseLayerMask(mask("1", "  ").parameters), undefined);
    assert.equal(parseLayerMask([]), undefined);
  });
});

describe("findLayerMask", () => {
  it("reads the last enabled Mask on the layer", () => {
    const effects = [
      mask("1", "2"),
      mask("1", "3", "Subtractive"),
      mask("1", "4", "Additive", false),
    ];
    assert.deepEqual(findLayerMask(effects, "1"), {
      targetLaneId: "3",
      mode: "subtractive",
    });
  });

  it("prefers the clip's own Mask over its layer's", () => {
    const effects = [mask("clip:a", "3"), mask("1", "2")];
    assert.equal(findLayerMask(effects, "1", "clip:a")?.targetLaneId, "3");
    assert.equal(findLayerMask(effects, "1", "clip:b")?.targetLaneId, "2");
  });

  it("ignores other layers' Masks and a layer masking itself", () => {
    assert.equal(findLayerMask([mask("2", "3")], "1"), undefined);
    assert.equal(findLayerMask([mask("1", "1")], "1"), undefined);
  });
});

describe("maskCoverage", () => {
  it("keeps the layer where the target draws when Additive", () => {
    assert.equal(maskCoverage(1, "additive"), 1);
    assert.equal(maskCoverage(0.25, "additive"), 0.25);
    assert.equal(maskCoverage(0, "additive"), 0);
  });

  it("cuts the target's pixels out when Subtractive", () => {
    assert.equal(maskCoverage(1, "subtractive"), 0);
    assert.equal(maskCoverage(0.25, "subtractive"), 0.75);
    assert.equal(maskCoverage(0, "subtractive"), 1);
  });

  // A target with no active clip draws nothing anywhere.
  it("hides the layer when Additive and leaves it when Subtractive with nothing drawn", () => {
    assert.equal(maskCoverage(0, "additive"), 0);
    assert.equal(maskCoverage(0, "subtractive"), 1);
  });

  it("clamps the target's alpha", () => {
    assert.equal(maskCoverage(2, "additive"), 1);
    assert.equal(maskCoverage(-1, "subtractive"), 1);
  });
});

describe("pruneMaskTargets", () => {
  it("clears Targets of layers that no longer exist", () => {
    const effects = [mask("1", "2"), mask("3", "9"), mask("4", "")];
    const pruned = pruneMaskTargets(effects, ["1", "2", "3", "4"]);
    assert.equal(pruned[0], effects[0]);
    assert.equal(pruned[2], effects[2]);
    assert.equal(
      pruned[1].parameters.find((parameter) => parameter.key === "Target")
        ?.value,
      "",
    );
    assert.equal(
      pruned[1].parameters.find((parameter) => parameter.key === "Mode")?.value,
      "Additive",
    );
  });

  it("leaves other effects alone", () => {
    const other = {
      trackId: "1",
      effectName: "Order",
      parameters: [{ key: "Target", value: "9" }],
    };
    assert.equal(pruneMaskTargets([other], [])[0], other);
  });
});
