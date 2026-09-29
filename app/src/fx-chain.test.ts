import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDABLE_EFFECT_DEFINITIONS,
  describeDeviceMove,
  dropSlotToStackIndex,
  FX_COLLAPSED_STORAGE_KEY,
  getAddableEffectDefinitions,
  getAutoScrollDelta,
  getDefaultLaneId,
  getDropSlot,
  getParameterFormat,
  groupChainDevices,
  isNoopDropSlot,
  knobColumnCount,
  readCollapsedDevices,
  resolveSelectedLaneId,
  stepSelectedLaneId,
  toggleCollapsedDevice,
  writeCollapsedDevices,
} from "./fx-chain.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  mapSessionEffectsToDevices,
  moveEffect,
  type SessionEffect,
} from "./fx-stack.ts";

function effect(
  id: string,
  trackId: string,
  effectName: string,
): SessionEffect {
  return { id, trackId, effectName, parameters: [], enabled: true };
}

// Layer 3 of dogfood3.lvp with its own Layout, plus a Global effect.
const DOGFOOD_EFFECTS = [
  effect("fx-layout", "3", "Layout"),
  effect("fx-1", "3", "Pixelate"),
  effect("fx-2", "3", "Colorize"),
  effect("fx-global", GLOBAL_EFFECT_TRACK_ID, "Colorize"),
  effect("fx-3", "3", "NegativeSplit"),
  effect("fx-4", "3", "AnalogGlitch"),
  effect("fx-other", "1", "ZoomAndPan"),
];

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("groupChainDevices", () => {
  it("lists the layer stack in order, then the Global stack", () => {
    const groups = groupChainDevices(
      mapSessionEffectsToDevices(DOGFOOD_EFFECTS, "3", "Layer 3"),
      "video",
    );
    assert.deepEqual(
      groups.layer.map((device) => device.name),
      ["Layout", "Pixelate", "Colorize", "Negative Split", "Analog Glitch"],
    );
    assert.deepEqual(
      groups.global.map((device) => device.name),
      ["Colorize"],
    );
  });

  it("shows nothing for a stack with no effects", () => {
    const groups = groupChainDevices(
      mapSessionEffectsToDevices([], "2", "Layer 2"),
      "video",
    );
    assert.deepEqual(groups, { layer: [], global: [] });
  });

  it("shows no devices for audio clips", () => {
    const groups = groupChainDevices(
      mapSessionEffectsToDevices(DOGFOOD_EFFECTS, "3", "Layer 3"),
      "audio",
    );
    assert.deepEqual(groups, { layer: [], global: [] });
  });
});

describe("ADDABLE_EFFECT_DEFINITIONS", () => {
  it("leaves Layout out, since every layer already has one", () => {
    const names = ADDABLE_EFFECT_DEFINITIONS.map(
      (definition) => definition.effectName,
    );
    assert.ok(names.includes("Colorize"));
    assert.ok(!names.includes("Layout"));
  });

  it("offers Transform on layer stacks only", () => {
    const names = (group: "layer" | "global") =>
      getAddableEffectDefinitions(group).map(
        (definition) => definition.effectName,
      );
    assert.ok(names("layer").includes("Transform"));
    assert.ok(!names("global").includes("Transform"));
    assert.ok(names("global").includes("Colorize"));
  });

  it("offers Order on the Global stack only", () => {
    const names = (group: "layer" | "global") =>
      getAddableEffectDefinitions(group).map(
        (definition) => definition.effectName,
      );
    assert.ok(names("global").includes("Order"));
    assert.ok(!names("layer").includes("Order"));
  });
});

describe("getParameterFormat", () => {
  it("uses the registry format for known parameters", () => {
    assert.equal(getParameterFormat("Colorize", "_HueOffset")(0.5), "+180°");
    assert.equal(getParameterFormat("Pixelate", "_NumPixels")(0.5), "50%");
    assert.equal(getParameterFormat("Transform", "PositionX")(0.25), "+25%");
    assert.equal(getParameterFormat("Transform", "ScaleY")(1.5), "150%");
    assert.equal(getParameterFormat("Transform", "Rotation")(-45), "-45°");
    assert.equal(getParameterFormat("Order", "GridSize")(3), "3×3");
    assert.equal(getParameterFormat("Order", "Spacing")(4), "4 px");
  });

  it("falls back to raw numbers for unknown parameters", () => {
    assert.equal(getParameterFormat("Mystery", "_Amount")(0.25), "0.250");
  });
});

describe("knobColumnCount", () => {
  it("fills two columns before wrapping down", () => {
    assert.equal(knobColumnCount(0), 1);
    assert.equal(knobColumnCount(1), 1);
    assert.equal(knobColumnCount(2), 2);
    assert.equal(knobColumnCount(3), 2);
    assert.equal(knobColumnCount(4), 2);
    assert.equal(knobColumnCount(5), 2);
    assert.equal(knobColumnCount(6), 2);
  });
});

describe("collapsed device storage", () => {
  it("round-trips collapsed device ids", () => {
    const storage = memoryStorage();
    writeCollapsedDevices(storage, new Set(["fx-2", "fx-1"]));
    assert.equal(
      storage.values.get(FX_COLLAPSED_STORAGE_KEY),
      '["fx-1","fx-2"]',
    );
    assert.deepEqual(Array.from(readCollapsedDevices(storage)).sort(), [
      "fx-1",
      "fx-2",
    ]);
  });

  it("ignores missing, malformed and non-string entries", () => {
    assert.equal(readCollapsedDevices(undefined).size, 0);
    assert.equal(readCollapsedDevices(memoryStorage()).size, 0);
    assert.equal(
      readCollapsedDevices(
        memoryStorage({ [FX_COLLAPSED_STORAGE_KEY]: "{not json" }),
      ).size,
      0,
    );
    assert.deepEqual(
      Array.from(
        readCollapsedDevices(
          memoryStorage({ [FX_COLLAPSED_STORAGE_KEY]: '["fx-1", 4, null]' }),
        ),
      ),
      ["fx-1"],
    );
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readCollapsedDevices(broken).size, 0);
    assert.doesNotThrow(() => writeCollapsedDevices(broken, new Set(["fx-1"])));
  });

  it("toggles one device without mutating the input", () => {
    const collapsed = new Set(["fx-1"]);
    assert.deepEqual(
      Array.from(toggleCollapsedDevice(collapsed, "fx-2")).sort(),
      ["fx-1", "fx-2"],
    );
    assert.deepEqual(Array.from(toggleCollapsedDevice(collapsed, "fx-1")), []);
    assert.deepEqual(Array.from(collapsed), ["fx-1"]);
  });
});

describe("drag reordering", () => {
  // Midpoints of four 100px panels starting at x = 0 with a 10px gap.
  const midpoints = [50, 160, 270, 380];

  it("finds the slot between panels under the pointer", () => {
    assert.equal(getDropSlot(midpoints, 10), 0);
    assert.equal(getDropSlot(midpoints, 100), 1);
    assert.equal(getDropSlot(midpoints, 300), 3);
    assert.equal(getDropSlot(midpoints, 900), 4);
    assert.equal(getDropSlot([], 900), 0);
  });

  it("maps slots to moveEffect indices and skips no-op drops", () => {
    // Dragging the second device (index 1).
    assert.equal(dropSlotToStackIndex(1, 0), 0);
    assert.equal(dropSlotToStackIndex(1, 3), 2);
    assert.equal(dropSlotToStackIndex(1, 4), 3);
    assert.ok(isNoopDropSlot(1, 1));
    assert.ok(isNoopDropSlot(1, 2));
    assert.ok(!isNoopDropSlot(1, 0));
    assert.ok(!isNoopDropSlot(1, 3));
  });

  it("drops Colorize before Pixelate on Layer 3", () => {
    // Colorize is at index 2; the pointer lands left of Pixelate's midpoint.
    const next = moveEffect(
      DOGFOOD_EFFECTS,
      "fx-2",
      dropSlotToStackIndex(2, getDropSlot(midpoints, 100)),
    );
    const layer = groupChainDevices(
      mapSessionEffectsToDevices(next, "3", "Layer 3"),
      "video",
    ).layer;
    assert.deepEqual(
      layer.map((device) => device.name),
      ["Layout", "Colorize", "Pixelate", "Negative Split", "Analog Glitch"],
    );
  });

  it("auto-scrolls faster the closer the pointer is to an edge", () => {
    assert.equal(getAutoScrollDelta(300, 0, 600), 0);
    assert.equal(getAutoScrollDelta(0, 0, 600), -18);
    assert.equal(getAutoScrollDelta(600, 0, 600), 18);
    const near = getAutoScrollDelta(590, 0, 600);
    const far = getAutoScrollDelta(560, 0, 600);
    assert.ok(near > far && far > 0);
    assert.equal(getAutoScrollDelta(-50, 0, 600), -18);
    assert.equal(getAutoScrollDelta(10, 0, 0), 0);
  });

  it("announces moves with the position in the stack", () => {
    const [colorize] = mapSessionEffectsToDevices(
      [DOGFOOD_EFFECTS[2]],
      "3",
      "Layer 3",
    ).filter((device) => device.name === "Colorize");
    assert.equal(
      describeDeviceMove(colorize, 0, 4),
      "Moved Colorize to position 1 of 4 in Layer 3",
    );
    const [global] = mapSessionEffectsToDevices([DOGFOOD_EFFECTS[3]], "3");
    assert.equal(
      describeDeviceMove(global, 0, 1),
      "Moved Colorize to position 1 of 1 in Global",
    );
  });
});

describe("resolveSelectedLaneId", () => {
  const lanes = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const effects = [
    effect("layout-1", "1", "Layout"),
    effect("fx-1", "3", "Pixelate"),
  ];

  it("follows the selected clip's layer", () => {
    assert.equal(
      resolveSelectedLaneId(lanes, effects, "3", { id: "c", laneId: "1" }),
      "1",
    );
  });

  it("keeps the selected layer when no clip is selected", () => {
    assert.equal(resolveSelectedLaneId(lanes, effects, "2", undefined), "2");
  });

  it("falls back to the default when the selected layer was removed", () => {
    assert.equal(resolveSelectedLaneId(lanes, effects, "9", undefined), "3");
    assert.equal(
      resolveSelectedLaneId(lanes, effects, undefined, {
        id: "c",
        laneId: "9",
      }),
      "3",
    );
  });

  it("returns undefined when there are no layers", () => {
    assert.equal(resolveSelectedLaneId([], effects, "1", undefined), undefined);
  });
});

describe("stepSelectedLaneId", () => {
  const lanes = [{ id: "1" }, { id: "2" }, { id: "3" }];

  it("moves to the neighbouring layer", () => {
    assert.equal(stepSelectedLaneId(lanes, "2", -1), "1");
    assert.equal(stepSelectedLaneId(lanes, "2", 1), "3");
  });

  it("stops at the first and last layer", () => {
    assert.equal(stepSelectedLaneId(lanes, "1", -1), "1");
    assert.equal(stepSelectedLaneId(lanes, "3", 1), "3");
  });

  it("starts from an end when no layer is selected", () => {
    assert.equal(stepSelectedLaneId(lanes, undefined, 1), "1");
    assert.equal(stepSelectedLaneId(lanes, "9", -1), "3");
  });

  it("returns undefined when there are no layers", () => {
    assert.equal(stepSelectedLaneId([], "1", 1), undefined);
  });
});

describe("getDefaultLaneId", () => {
  it("prefers the first layer with effects besides its Layout", () => {
    assert.equal(
      getDefaultLaneId(
        [{ id: "1" }, { id: "2" }, { id: "3" }],
        [
          effect("layout-1", "1", "Layout"),
          effect("fx-global", GLOBAL_EFFECT_TRACK_ID, "Colorize"),
          effect("layout-2", "2", "Layout"),
          effect("fx-2", "2", "Colorize"),
        ],
      ),
      "2",
    );
  });

  it("falls back to the first layer", () => {
    assert.equal(getDefaultLaneId([{ id: "1" }, { id: "2" }], []), "1");
  });
});
