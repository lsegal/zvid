import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toggleLayerId } from "./composition-order.ts";
import {
  addableEffectsFor,
  canStartFxChainPan,
  describeArrangedLayers,
  describeDeviceMove,
  dropSlotToStackIndex,
  excludeAllLayers,
  FX_COLLAPSED_STORAGE_KEY,
  getAutoScrollDelta,
  getDefaultLaneId,
  getDropSlot,
  getFxClipName,
  getFxPanelTitle,
  getParameterFormat,
  groupChainDevices,
  isNoopDropSlot,
  knobColumnCount,
  NO_ORDER_HINT,
  readCollapsedDevices,
  resolveGlobalOrderHint,
  resolveSelectedLaneId,
  splitDeviceParameters,
  splitKnobRows,
  stepSelectedLaneId,
  toggleCollapsedDevice,
  writeCollapsedDevices,
} from "./fx-chain.ts";
import {
  clipEffectTrackId,
  ensureGlobalOrder,
  GLOBAL_EFFECT_TRACK_ID,
  mapSessionEffectsToDevices,
  moveEffect,
  type SessionEffect,
  setEffectEnabled,
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
    assert.deepEqual(groups, { global: [], layer: [], clip: [] });
  });

  it("shows no devices for audio clips", () => {
    const groups = groupChainDevices(
      mapSessionEffectsToDevices(DOGFOOD_EFFECTS, "3", "Layer 3"),
      "audio",
    );
    assert.deepEqual(groups, { global: [], layer: [], clip: [] });
  });

  it("lists the selected clip's own stack, apart from other clips'", () => {
    const effects = [
      ...DOGFOOD_EFFECTS,
      effect("fx-clip", clipEffectTrackId("clip-a"), "Transform"),
      effect("fx-other-clip", clipEffectTrackId("clip-b"), "Pixelate"),
    ];
    const groups = groupChainDevices(
      mapSessionEffectsToDevices(
        effects,
        "3",
        "Layer 3",
        [],
        new Set(),
        "clip-a",
      ),
      "video",
    );
    assert.deepEqual(
      groups.clip.map((device) => [device.name, device.subtitle]),
      [["Transform", "Clip"]],
    );
    assert.equal(groups.clip[0].unsupported, undefined);
    assert.equal(groups.layer.length, 5);
    assert.equal(groups.global.length, 1);
  });

  it("lists no clip stack without a selected clip", () => {
    const effects = [
      ...DOGFOOD_EFFECTS,
      effect("fx-clip", clipEffectTrackId("clip-a"), "Transform"),
    ];
    const groups = groupChainDevices(
      mapSessionEffectsToDevices(effects, "3", "Layer 3"),
      "video",
    );
    assert.deepEqual(groups.clip, []);
  });
});

describe("getFxPanelTitle", () => {
  it("names the selected clip and its layer", () => {
    assert.equal(
      getFxPanelTitle("Layer 2", "Text"),
      "Clip Text Effects (Layer 2)",
    );
  });

  it("names the layer when no clip is selected", () => {
    assert.equal(getFxPanelTitle("Layer 2", undefined), "Layer 2 Effects");
  });

  it("names the Global stack when nothing is selected", () => {
    assert.equal(getFxPanelTitle(undefined, undefined), "Global Effects");
  });
});

describe("getFxClipName", () => {
  it("uses the clip's label", () => {
    assert.equal(getFxClipName("Intro.mp4", "Hello"), "Intro.mp4");
  });

  it("falls back to the first line of the clip's text", () => {
    assert.equal(getFxClipName("  ", " Hello "), "Hello");
  });

  it("still names a clip with neither", () => {
    assert.equal(getFxClipName(""), "Untitled");
  });
});

describe("addableEffectsFor", () => {
  const names = (group: "layer" | "global" | "clip") =>
    addableEffectsFor(group).map((definition) => definition.effectName);

  it("offers only effects scoped to the Global stack in the Global menu", () => {
    assert.ok(
      addableEffectsFor("global").every((definition) =>
        definition.scopes.includes("global"),
      ),
    );
    assert.deepEqual(names("global"), [
      "ZoomAndPan",
      "Colorize",
      "Pixelate",
      "NegativeSplit",
      "AnalogGlitch",
      "Order",
    ]);
  });

  it("offers only layer-scoped effects in the layer menu", () => {
    assert.ok(
      addableEffectsFor("layer").every((definition) =>
        definition.scopes.includes("layer"),
      ),
    );
    assert.deepEqual(names("layer"), [
      "ZoomAndPan",
      "Colorize",
      "Pixelate",
      "NegativeSplit",
      "AnalogGlitch",
      "Transform",
      "Move",
      "Color",
    ]);
  });

  it("never offers Layout, which every layer already has", () => {
    assert.ok(!names("layer").includes("Layout"));
    assert.ok(!names("global").includes("Layout"));
    assert.ok(!names("clip").includes("Layout"));
  });

  it("offers only clip-scoped effects in the clip menu", () => {
    assert.ok(
      addableEffectsFor("clip").every((definition) =>
        definition.scopes.includes("clip"),
      ),
    );
    assert.ok(names("clip").includes("Transform"));
    assert.ok(!names("clip").includes("Order"));
  });

  it("offers Color, which paints fill clips, on layers and clips", () => {
    assert.ok(names("layer").includes("Color"));
    assert.ok(names("clip").includes("Color"));
    assert.ok(!names("global").includes("Color"));
  });

  it("offers Text, which styles text clips, on clips only", () => {
    assert.ok(names("clip").includes("Text"));
    assert.ok(!names("layer").includes("Text"));
    assert.ok(!names("global").includes("Text"));
  });

  it("offers Order on the Global stack only", () => {
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
  it("keeps knobs to two rows of at least two columns", () => {
    const layouts = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((count) => {
      const columns = knobColumnCount(count);
      return [count, columns, Math.ceil(count / columns)];
    });
    assert.deepEqual(layouts, [
      [0, 1, 0],
      [1, 1, 1],
      [2, 2, 1],
      [3, 2, 2],
      [4, 2, 2],
      [5, 3, 2],
      [6, 3, 2],
      [7, 4, 2],
      [8, 4, 2],
    ]);
  });

  it("lays Transform out as X Y Width Height / Origin X Origin Y Rotation", () => {
    const [transform] = mapSessionEffectsToDevices(
      [effect("fx-transform", "3", "Transform")],
      "3",
    );
    const { controls, knobs } = splitDeviceParameters(transform.parameters);
    const columns = knobColumnCount(knobs.length);
    const rows = [];
    for (let start = 0; start < knobs.length; start += columns) {
      rows.push(knobs.slice(start, start + columns).map((knob) => knob.label));
    }

    assert.deepEqual(controls, []);
    assert.deepEqual(rows, [
      ["X", "Y", "Width", "Height"],
      ["Origin X", "Origin Y", "Rotation"],
    ]);
  });

  it("lays Move out as a Motion row, then labeled Start and End rows", () => {
    const [move] = mapSessionEffectsToDevices(
      [effect("fx-move", "3", "Move")],
      "3",
    );
    const { controls, knobs } = splitDeviceParameters(move.parameters);
    const transformRow = [
      "X",
      "Y",
      "Width",
      "Height",
      "Origin X",
      "Origin Y",
      "Rotation",
    ];

    assert.deepEqual(
      controls.map((control) => [control.label, control.stringValue]),
      [["Motion", "Ease In Out"]],
    );
    assert.deepEqual(
      splitKnobRows(knobs, move.knobRows)?.map((row) => [
        row.label,
        row.knobs.map((knob) => knob.label),
      ]),
      [
        ["Start", transformRow],
        ["End", transformRow],
      ],
    );
    assert.equal(knobs[0].key, "StartPositionX");
    assert.equal(knobs[7].key, "EndPositionX");
  });
});

describe("splitKnobRows", () => {
  it("splits knobs evenly into the labeled rows", () => {
    assert.deepEqual(splitKnobRows([1, 2, 3, 4], ["A", "B"]), [
      { label: "A", knobs: [1, 2] },
      { label: "B", knobs: [3, 4] },
    ]);
  });

  it("leaves knobs without labels or an even split to the usual rows", () => {
    assert.equal(splitKnobRows([1, 2, 3], ["A", "B"]), undefined);
    assert.equal(splitKnobRows([1, 2], undefined), undefined);
    assert.equal(splitKnobRows([], ["A"]), undefined);
  });
});

describe("splitDeviceParameters", () => {
  it("puts enum controls before the knob grid", () => {
    const [order] = mapSessionEffectsToDevices(
      [
        {
          ...effect("fx-order", GLOBAL_EFFECT_TRACK_ID, "Order"),
          parameters: [{ key: "Arrangement", value: "Grid" }],
        },
      ],
      "3",
    );
    const { controls, knobs } = splitDeviceParameters(order.parameters);

    assert.deepEqual(
      controls.map((control) => control.key),
      ["Arrangement", "ExcludedLayers"],
    );
    assert.deepEqual(
      knobs.map((knob) => knob.key),
      ["GridSize", "Spacing", "Margin", "BorderColor"],
    );
  });

  it("keeps a color listed before the knobs with the controls", () => {
    const [color] = mapSessionEffectsToDevices(
      [effect("fx-color", "3", "Color")],
      "3",
    );
    const { controls, knobs } = splitDeviceParameters(color.parameters);

    assert.deepEqual(
      controls.map((control) => control.key),
      ["Mode", "Color"],
    );
    assert.deepEqual(
      knobs.map((knob) => knob.key),
      ["Opacity"],
    );
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

  it("moves to the neighboring layer", () => {
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

describe("canStartFxChainPan", () => {
  // A stand-in target inside the listed elements, innermost first.
  function target(...classes: string[]) {
    return {
      closest: (selector: string) =>
        classes.some((name) =>
          selector.split(", ").some((part) => part === name),
        ),
    } as unknown as EventTarget;
  }

  it("pans from the background with the primary button", () => {
    assert.equal(canStartFxChainPan({ button: 0, target: target() }), true);
    assert.equal(
      canStartFxChainPan({ button: 0, target: target(".fx-chain__divider") }),
      true,
    );
  });

  it("leaves devices, add slots and buttons to their own behavior", () => {
    for (const name of [
      ".fx-device-panel",
      ".fx-chain__add",
      ".fx-chain__layer-off",
      "button",
    ]) {
      assert.equal(
        canStartFxChainPan({ button: 0, target: target(name) }),
        false,
        name,
      );
    }
  });

  it("pans with the middle button anywhere, including over devices", () => {
    assert.equal(
      canStartFxChainPan({ button: 1, target: target(".fx-device-panel") }),
      true,
    );
  });

  it("ignores the secondary button so context menus still open", () => {
    assert.equal(canStartFxChainPan({ button: 2, target: target() }), false);
  });
});

describe("resolveGlobalOrderHint", () => {
  const globalDevices = (effects: SessionEffect[]) =>
    groupChainDevices(mapSessionEffectsToDevices(effects, "1"), "video").global;

  it("points out a Global stack with no Order", () => {
    assert.equal(resolveGlobalOrderHint(globalDevices([])), NO_ORDER_HINT);
    assert.equal(
      NO_ORDER_HINT,
      "No Order: layers overlap (Layer 1 on top). Add Order to arrange them.",
    );
  });

  it("stays quiet while the Global stack has an Order", () => {
    const effects = ensureGlobalOrder([]);
    assert.equal(resolveGlobalOrderHint(globalDevices(effects)), undefined);
    assert.equal(
      resolveGlobalOrderHint(
        globalDevices(setEffectEnabled(effects, "order-global", false)),
      ),
      undefined,
    );
  });
});

describe("Order Layers menu", () => {
  const layers = [1, 2, 3, 4, 5].map((number) => ({
    id: `${number}`,
    number,
    name: `Layer ${number}`,
  }));

  it("labels the button with how many layers the Order arranges", () => {
    assert.equal(describeArrangedLayers("", layers), "Layers: All");
    assert.equal(describeArrangedLayers("1,5", layers), "Layers: 3 of 5");
    assert.equal(
      describeArrangedLayers(excludeAllLayers(layers), layers),
      "Layers: None",
    );
  });

  it("updates the label as layers are toggled", () => {
    let value = "";
    value = toggleLayerId(value, "2");
    assert.equal(describeArrangedLayers(value, layers), "Layers: 4 of 5");
    value = toggleLayerId(value, "4");
    assert.equal(describeArrangedLayers(value, layers), "Layers: 3 of 5");
    value = toggleLayerId(value, "2");
    assert.equal(describeArrangedLayers(value, layers), "Layers: 4 of 5");
  });

  it("keeps exclusions by id when layers are renamed or reordered", () => {
    const renamed = [...layers]
      .reverse()
      .map((layer) => ({ ...layer, name: `${layer.name} (renamed)` }));
    assert.equal(describeArrangedLayers("3", renamed), "Layers: 4 of 5");
  });

  it("counts a new layer as arranged and ignores removed ones", () => {
    const added = [...layers, { id: "6", number: 6, name: "Layer 6" }];
    assert.equal(describeArrangedLayers("1", added), "Layers: 5 of 6");
    assert.equal(describeArrangedLayers("1,9", layers.slice(1)), "Layers: All");
  });
});
