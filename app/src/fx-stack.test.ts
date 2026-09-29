import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEffectDefinition } from "./fx-registry.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import {
  addEffect,
  duplicateEffect,
  effectHistoryLabels,
  ensureLayerLayouts,
  type FxLayer,
  GLOBAL_EFFECT_TRACK_ID,
  getRenderedEffects,
  isLayerFxEnabled,
  mapEffects,
  mapSessionEffectsToDevices,
  moveEffect,
  removeEffect,
  resetEffect,
  type SessionEffect,
  setEffectEnabled,
  setEffectParameter,
  setLaneFxEnabled,
} from "./fx-stack.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";
import type { LvpSession } from "./session.ts";

// The effect stacks of the dogfood3.lvp session: Layer 3 ("6") has four
// devices, and Layout sits on the global stack, as sessions from before
// Layout was per layer did.
const DOGFOOD_EFFECTS: LvpSession["effects"] = [
  {
    id: "zoom",
    trackId: "1",
    effectName: "ZoomAndPan",
    parameters: {
      _Start_Zoom: { floatValue: 0 },
      _End_Zoom: { floatValue: 0.23 },
      _LAYERS_SelFrac: { floatValue: 0.62 },
    },
  },
  {
    id: "pixelate",
    trackId: "6",
    effectName: "Pixelate",
    parameters: {
      _NumPixels: { floatValue: 0.83 },
      _LowIntensity: { floatValue: 0.1 },
      _HighIntensity: { floatValue: 0.9 },
    },
  },
  {
    id: "layout",
    trackId: GLOBAL_EFFECT_TRACK_ID,
    effectName: "Layout",
    parameters: { Position: { stringValue: "Center" } },
  },
  {
    id: "colorize",
    trackId: "6",
    effectName: "Colorize",
    parameters: {
      _HueOffset: { floatValue: 0.25 },
      _Reactivity: { floatValue: 0.4 },
    },
  },
  {
    id: "negative",
    trackId: "6",
    effectName: "NegativeSplit",
    parameters: {
      _LowIntensity: { floatValue: 0.2 },
      _HighIntensity: { floatValue: 0.8 },
    },
  },
  {
    id: "glitch",
    trackId: "6",
    effectName: "AnalogGlitch",
    parameters: {
      _LowMod: { floatValue: 0.3 },
      _HighMod: { floatValue: 0.6 },
    },
  },
];

function load() {
  return mapEffects(DOGFOOD_EFFECTS);
}

function ids(effects: SessionEffect[], trackId?: string) {
  return effects
    .filter((effect) => trackId === undefined || effect.trackId === trackId)
    .map((effect) => effect.id);
}

describe("mapEffects", () => {
  it("defaults effects to enabled", () => {
    assert.ok(load().every((effect) => effect.enabled));
  });
});

describe("mapSessionEffectsToDevices", () => {
  it("lists the layer stack in order, then the global stack", () => {
    const devices = mapSessionEffectsToDevices(load(), "6");
    assert.deepEqual(
      devices.map((device) => [device.name, device.group]),
      [
        ["Pixelate", "layer"],
        ["Colorize", "layer"],
        ["Negative Split", "layer"],
        ["Analog Glitch", "layer"],
        ["Layout", "global"],
      ],
    );
  });

  it("names the layer in subtitles", () => {
    const devices = mapSessionEffectsToDevices(load(), "6", "Layer 3");
    assert.equal(devices[0].subtitle, "Layer 3");
    assert.equal(devices[4].subtitle, "Global stack");
  });

  it("flags devices on a stack their effect isn't designed for", () => {
    const devices = mapSessionEffectsToDevices(
      [
        ...load(),
        {
          id: "layer-order",
          trackId: "6",
          effectName: "Order",
          enabled: true,
          parameters: [],
        },
        {
          id: "global-move",
          trackId: GLOBAL_EFFECT_TRACK_ID,
          effectName: "Transform",
          enabled: true,
          parameters: [],
        },
        {
          id: "global-mystery",
          trackId: GLOBAL_EFFECT_TRACK_ID,
          effectName: "Mystery",
          enabled: true,
          parameters: [],
        },
      ],
      "6",
    );
    assert.deepEqual(
      devices.map((device) => [device.name, device.unsupported ?? false]),
      [
        ["Pixelate", false],
        ["Colorize", false],
        ["Negative Split", false],
        ["Analog Glitch", false],
        ["Order", true],
        ["Layout", true],
        ["Transform", true],
        ["Mystery", false],
      ],
    );
  });

  it("uses friendly labels and hides internal parameters", () => {
    const [zoom] = mapSessionEffectsToDevices(load(), "1");
    assert.equal(zoom.name, "Zoom & Pan");
    const labels = zoom.parameters.map((parameter) => parameter.label);
    assert.deepEqual(labels, [
      "Start Zoom",
      "Start X",
      "Start Y",
      "End Zoom",
      "End X",
      "End Y",
    ]);
    assert.equal(zoom.parameters[3].display, "1.69×");
    assert.equal(zoom.parameters[4].display, "50%");

    const colorize = mapSessionEffectsToDevices(load(), "6")[1];
    assert.deepEqual(
      colorize.parameters.map((parameter) => [
        parameter.label,
        parameter.display,
      ]),
      [
        ["Hue Shift", "+90°"],
        ["Reactivity", "40%"],
      ],
    );
  });

  it("shows the Layout position as an enum", () => {
    const layout = mapSessionEffectsToDevices(load(), "6")[4];
    assert.equal(layout.parameters[0].kind, "enum");
    assert.equal(layout.parameters[0].stringValue, "Center");
    assert.deepEqual(layout.parameters[0].options, ["Center", "Top", "Bottom"]);
  });

  it("keeps unknown effects with their raw keys", () => {
    const effects: SessionEffect[] = [
      {
        id: "mystery",
        trackId: "1",
        effectName: "Mystery",
        parameters: [{ key: "_Amount", value: "0.250", numericValue: 0.25 }],
        enabled: true,
      },
    ];
    const devices = mapSessionEffectsToDevices(effects, "1");
    const mystery = devices.find((device) => device.id === "mystery");
    assert.equal(mystery?.name, "Mystery");
    assert.deepEqual(
      mystery?.parameters.map((parameter) => [
        parameter.label,
        parameter.display,
      ]),
      [["_Amount", "0.250"]],
    );
  });

  it("lists only real effects, with no placeholder Layout", () => {
    const layerOnly = load().filter(
      (effect) => effect.trackId !== GLOBAL_EFFECT_TRACK_ID,
    );
    const devices = mapSessionEffectsToDevices(layerOnly, "6");
    assert.ok(devices.every((device) => device.name !== "Layout"));
    assert.deepEqual(mapSessionEffectsToDevices([], "6"), []);
  });

  it("marks only a layer's own Layout as its default device", () => {
    const effects = ensureLayerLayouts(load(), ["6"]);
    const [layout, pixelate] = mapSessionEffectsToDevices(effects, "6");
    assert.equal(layout.name, "Layout");
    assert.equal(layout.group, "layer");
    assert.equal(layout.layerDefault, true);
    assert.equal(pixelate.layerDefault, undefined);
    assert.equal(
      mapSessionEffectsToDevices(load(), "6")[4].layerDefault,
      undefined,
    );
  });

  it("reports bypassed devices", () => {
    const effects = setEffectEnabled(load(), "colorize", false);
    const colorize = mapSessionEffectsToDevices(effects, "6")[1];
    assert.equal(colorize.enabled, false);
  });

  it("treats a missing bypass flag as enabled", () => {
    const effects = load().map((effect) => ({
      ...effect,
      enabled: undefined as unknown as boolean,
    }));
    const devices = mapSessionEffectsToDevices(effects, "6");
    assert.ok(devices.every((device) => device.enabled));
    assert.equal(setEffectEnabled(effects, "colorize", true), effects);
  });
});

describe("setEffectParameter", () => {
  it("returns a new array with the updated value", () => {
    const effects = load();
    const next = setEffectParameter(effects, "colorize", "_HueOffset", -0.5);
    assert.notEqual(next, effects);
    const colorize = next.find((effect) => effect.id === "colorize");
    assert.deepEqual(
      colorize?.parameters.find((parameter) => parameter.key === "_HueOffset"),
      { key: "_HueOffset", value: "-0.500", numericValue: -0.5 },
    );
    assert.equal(
      effects
        .find((effect) => effect.id === "colorize")
        ?.parameters.find((parameter) => parameter.key === "_HueOffset")
        ?.numericValue,
      0.25,
    );
  });

  it("clamps known parameters to their range", () => {
    const next = setEffectParameter(load(), "colorize", "_HueOffset", 4);
    const colorize = next.find((effect) => effect.id === "colorize");
    assert.equal(colorize?.parameters[0].numericValue, 1);
  });

  it("sets enum values and adds missing parameters", () => {
    const next = setEffectParameter(load(), "layout", "Position", "Top");
    assert.deepEqual(
      next.find((effect) => effect.id === "layout")?.parameters,
      [{ key: "Position", value: "Top" }],
    );

    const zoom = setEffectParameter(load(), "zoom", "_End_X", 0.5).find(
      (effect) => effect.id === "zoom",
    );
    assert.equal(zoom?.parameters.at(-1)?.key, "_End_X");
  });

  it("returns the same array when nothing changes", () => {
    const effects = load();
    assert.equal(
      setEffectParameter(effects, "colorize", "_HueOffset", 0.25),
      effects,
    );
    assert.equal(setEffectParameter(effects, "missing", "_X", 1), effects);
  });
});

describe("moveEffect", () => {
  it("reorders within the stack and leaves other stacks in place", () => {
    const effects = load();
    const next = moveEffect(effects, "colorize", 0);
    assert.deepEqual(ids(next, "6"), [
      "colorize",
      "pixelate",
      "negative",
      "glitch",
    ]);
    assert.equal(next[0].id, "zoom");
    assert.equal(next[2].id, "layout");
  });

  it("clamps the target index to the stack", () => {
    const next = moveEffect(load(), "pixelate", 99);
    assert.deepEqual(ids(next, "6"), [
      "colorize",
      "negative",
      "glitch",
      "pixelate",
    ]);
  });

  it("rejects cross-stack moves", () => {
    const effects = load();
    assert.equal(
      moveEffect(effects, "colorize", 0, GLOBAL_EFFECT_TRACK_ID),
      effects,
    );
    assert.equal(moveEffect(effects, "layout", 0, "6"), effects);
  });

  it("returns the same array for no-op moves", () => {
    const effects = load();
    assert.equal(moveEffect(effects, "pixelate", 0), effects);
    assert.equal(moveEffect(effects, "missing", 0), effects);
  });
});

describe("addEffect", () => {
  it("appends to the stack with registry defaults", () => {
    const next = addEffect(load(), "6", "Pixelate", undefined, "new");
    assert.deepEqual(ids(next, "6"), [
      "pixelate",
      "colorize",
      "negative",
      "glitch",
      "new",
    ]);
    const added = next.find((effect) => effect.id === "new");
    assert.equal(added?.enabled, true);
    assert.deepEqual(
      added?.parameters.map((parameter) => [
        parameter.key,
        parameter.numericValue,
      ]),
      getEffectDefinition("Pixelate").parameters.map((parameter) => [
        parameter.key,
        parameter.defaultValue,
      ]),
    );
  });

  it("inserts at a stack index", () => {
    const next = addEffect(load(), "6", "Colorize", 1, "new");
    assert.deepEqual(ids(next, "6"), [
      "pixelate",
      "new",
      "colorize",
      "negative",
      "glitch",
    ]);
  });

  it("adds at most one Layout per layer and none to the Global stack", () => {
    const effects = addEffect(load(), "6", "Layout", 0, "layer-layout");
    assert.equal(ids(effects, "6")[0], "layer-layout");
    assert.equal(addEffect(effects, "6", "Layout"), effects);
    assert.equal(addEffect(effects, GLOBAL_EFFECT_TRACK_ID, "Layout"), effects);
  });

  it("adds Transform to layers with identity defaults, never to Global", () => {
    const effects = addEffect(load(), "6", "Transform", undefined, "move");
    const added = effects.find((effect) => effect.id === "move");
    assert.deepEqual(
      added?.parameters.map((parameter) => [
        parameter.key,
        parameter.numericValue,
      ]),
      [
        ["PositionX", 0],
        ["PositionY", 0],
        ["ScaleX", 1],
        ["ScaleY", 1],
        ["OriginX", 0],
        ["OriginY", 0],
        ["Rotation", 0],
      ],
    );
    assert.equal(
      addEffect(effects, GLOBAL_EFFECT_TRACK_ID, "Transform"),
      effects,
    );
  });

  it("adds Order to the Global stack with defaults, never to a layer", () => {
    const effects = addEffect(
      load(),
      GLOBAL_EFFECT_TRACK_ID,
      "Order",
      undefined,
      "order",
    );
    const added = effects.find((effect) => effect.id === "order");
    assert.deepEqual(added?.parameters, [
      { key: "Arrangement", value: "Vertical" },
      { key: "GridSize", value: "2.000", numericValue: 2 },
      { key: "Spacing", value: "0.000", numericValue: 0 },
    ]);
    assert.equal(addEffect(effects, "6", "Order"), effects);
  });

  it("starts a new stack and generates ids", () => {
    const next = addEffect(load(), "5", "Layout");
    const added = next.at(-1);
    assert.equal(added?.trackId, "5");
    assert.match(added?.id ?? "", /^[0-9a-f-]{36}$/);
    assert.deepEqual(added?.parameters, [{ key: "Position", value: "Center" }]);
  });
});

describe("removeEffect and setEffectEnabled", () => {
  it("removes an effect", () => {
    const next = removeEffect(load(), "negative");
    assert.deepEqual(ids(next, "6"), ["pixelate", "colorize", "glitch"]);
    const effects = load();
    assert.equal(removeEffect(effects, "missing"), effects);
  });

  it("keeps a layer's own Layout but removes a legacy global one", () => {
    const effects = ensureLayerLayouts(load(), ["6"]);
    assert.equal(removeEffect(effects, "layout-6"), effects);
    assert.deepEqual(
      ids(removeEffect(load(), "layout"), GLOBAL_EFFECT_TRACK_ID),
      [],
    );
  });

  it("toggles the bypass flag", () => {
    const effects = load();
    const next = setEffectEnabled(effects, "glitch", false);
    assert.equal(next.find((effect) => effect.id === "glitch")?.enabled, false);
    assert.equal(setEffectEnabled(effects, "glitch", true), effects);
  });
});

describe("duplicateEffect", () => {
  it("inserts a copy right after the original", () => {
    const effects = setEffectEnabled(
      setEffectParameter(load(), "colorize", "_HueOffset", 0.25),
      "colorize",
      false,
    );
    const next = duplicateEffect(effects, "colorize", "copy");
    assert.deepEqual(ids(next, "6"), [
      "pixelate",
      "colorize",
      "copy",
      "negative",
      "glitch",
    ]);
    const original = next.find((effect) => effect.id === "colorize");
    const copy = next.find((effect) => effect.id === "copy");
    assert.equal(copy?.trackId, "6");
    assert.equal(copy?.enabled, false);
    assert.deepEqual(copy?.parameters, original?.parameters);
    assert.notEqual(copy?.parameters[0], original?.parameters[0]);
  });

  it("returns the same array for unknown ids", () => {
    const effects = load();
    assert.equal(duplicateEffect(effects, "missing"), effects);
  });

  it("never duplicates a layer's own Layout", () => {
    const effects = ensureLayerLayouts(load(), ["6"]);
    assert.equal(duplicateEffect(effects, "layout-6", "copy"), effects);
  });
});

describe("resetEffect", () => {
  it("restores registry defaults and turns the effect back on", () => {
    const edited = setEffectEnabled(
      setEffectParameter(
        ensureLayerLayouts(load(), ["6"]),
        "layout-6",
        "Position",
        "Top",
      ),
      "layout-6",
      false,
    );
    const next = resetEffect(edited, "layout-6");
    const layout = next.find((effect) => effect.id === "layout-6");
    assert.deepEqual(layout?.parameters, [
      { key: "Position", value: "Center" },
    ]);
    assert.equal(layout?.enabled, true);
  });

  it("returns the same array when already at defaults", () => {
    const effects = ensureLayerLayouts([], ["6"]);
    assert.equal(resetEffect(effects, "layout-6"), effects);
    assert.equal(resetEffect(effects, "missing"), effects);
  });
});

describe("ensureLayerLayouts", () => {
  it("gives every layer a default Layout at the start of its stack", () => {
    const next = ensureLayerLayouts([], ["1", "5"]);
    assert.deepEqual(
      next.map((effect) => [effect.id, effect.trackId, effect.effectName]),
      [
        ["layout-1", "1", "Layout"],
        ["layout-5", "5", "Layout"],
      ],
    );
    assert.deepEqual(next[0].parameters, [
      { key: "Position", value: "Center" },
    ]);
  });

  it("moves a global Layout's position onto each layer", () => {
    const effects = setEffectParameter(load(), "layout", "Position", "Bottom");
    const next = ensureLayerLayouts(effects, ["1", "5", "6"]);
    assert.deepEqual(ids(next, GLOBAL_EFFECT_TRACK_ID), []);
    for (const laneId of ["1", "5", "6"]) {
      const [first] = next.filter((effect) => effect.trackId === laneId);
      assert.equal(first.id, `layout-${laneId}`);
      assert.deepEqual(first.parameters, [
        { key: "Position", value: "Bottom" },
      ]);
    }
    assert.deepEqual(ids(next, "6"), [
      "layout-6",
      "pixelate",
      "colorize",
      "negative",
      "glitch",
    ]);
  });

  it("ignores a bypassed global Layout, which anchored nothing", () => {
    const effects = setEffectEnabled(
      setEffectParameter(load(), "layout", "Position", "Top"),
      "layout",
      false,
    );
    const [layout] = ensureLayerLayouts(effects, ["1"]);
    assert.deepEqual(layout.parameters, [{ key: "Position", value: "Center" }]);
  });

  it("keeps a layer's own Layout", () => {
    const effects = ensureLayerLayouts(
      setEffectParameter(
        addEffect(load(), "6", "Layout", 2, "own"),
        "own",
        "Position",
        "Top",
      ),
      ["6"],
    );
    assert.deepEqual(ids(effects, "6"), [
      "pixelate",
      "colorize",
      "own",
      "negative",
      "glitch",
    ]);
    assert.deepEqual(
      effects.find((effect) => effect.id === "own")?.parameters,
      [{ key: "Position", value: "Top" }],
    );
  });

  it("returns the same array when every layer already has a Layout", () => {
    const effects = ensureLayerLayouts(load(), ["1", "6"]);
    assert.equal(ensureLayerLayouts(effects, ["1", "6"]), effects);
  });

  it("generates an id when the stable one is taken", () => {
    const effects = ensureLayerLayouts(
      [
        {
          id: "layout-2",
          trackId: "9",
          effectName: "Pixelate",
          parameters: [],
          enabled: true,
        },
      ],
      ["2"],
    );
    const [layout] = effects.filter((effect) => effect.trackId === "2");
    assert.match(layout.id, /^[0-9a-f-]{36}$/);
  });
});

describe("effect history", () => {
  type State = { effects: SessionEffect[] };
  const edit =
    (updater: (effects: SessionEffect[]) => SessionEffect[]) =>
    (current: State) => {
      const effects = updater(current.effects);
      return effects === current.effects ? current : { effects };
    };

  it("labels edits", () => {
    assert.equal(
      effectHistoryLabels.parameter("Colorize", "_HueOffset"),
      "Change Hue Shift",
    );
    assert.equal(effectHistoryLabels.move("Colorize"), "Move Colorize");
    assert.equal(effectHistoryLabels.add("Pixelate"), "Add Pixelate");
    assert.equal(
      effectHistoryLabels.duplicate("NegativeSplit"),
      "Duplicate Negative Split",
    );
    assert.equal(
      effectHistoryLabels.remove("AnalogGlitch"),
      "Remove Analog Glitch",
    );
    assert.equal(effectHistoryLabels.reset("Layout"), "Reset Layout");
  });

  it("records a drag as one entry and undoes it to the original value", () => {
    const initial: State = { effects: load() };
    let history = createProjectHistoryState(initial);
    for (const value of [0.3, 0.4, 0.5]) {
      history = projectHistoryReducer(history, {
        type: "transient",
        updater: edit((effects) =>
          setEffectParameter(effects, "colorize", "_HueOffset", value),
        ),
      });
    }
    history = projectHistoryReducer(history, {
      type: "commit",
      label: "Change Hue Shift",
      updater: edit((effects) =>
        setEffectParameter(effects, "colorize", "_HueOffset", 0.5),
      ),
    });

    assert.equal(history.past.length, 1);
    assert.equal(history.past[0].label, "Change Hue Shift");
    assert.equal(history.past[0].snapshot, initial);
    assert.equal(history.transientBase, undefined);

    history = projectHistoryReducer(history, { type: "undo" });
    assert.equal(history.present, initial);
    history = projectHistoryReducer(history, { type: "redo" });
    assert.equal(
      history.present.effects.find((effect) => effect.id === "colorize")
        ?.parameters[0].numericValue,
      0.5,
    );
  });

  it("undoes and redoes structural edits", () => {
    const initial: State = { effects: load() };
    let history = createProjectHistoryState(initial);
    const steps: Array<
      [string, (effects: SessionEffect[]) => SessionEffect[]]
    > = [
      ["Move Colorize", (effects) => moveEffect(effects, "colorize", 0)],
      [
        "Add Pixelate",
        (effects) => addEffect(effects, "6", "Pixelate", undefined, "new"),
      ],
      ["Remove Analog Glitch", (effects) => removeEffect(effects, "glitch")],
      [
        "Duplicate Pixelate",
        (effects) => duplicateEffect(effects, "pixelate", "copy"),
      ],
      [
        "Bypass Negative Split",
        (effects) => setEffectEnabled(effects, "negative", false),
      ],
    ];
    for (const [label, updater] of steps) {
      history = projectHistoryReducer(history, {
        type: "commit",
        label,
        updater: edit(updater),
      });
    }
    const final = history.present;
    assert.equal(history.past.length, steps.length);

    for (let index = 0; index < steps.length; index += 1) {
      history = projectHistoryReducer(history, { type: "undo" });
    }
    assert.equal(history.present, initial);

    for (let index = 0; index < steps.length; index += 1) {
      history = projectHistoryReducer(history, { type: "redo" });
    }
    assert.equal(history.present, final);
  });

  it("skips commits that change nothing", () => {
    const initial: State = { effects: load() };
    const history = createProjectHistoryState(initial);
    const next = projectHistoryReducer(history, {
      type: "commit",
      label: "Change Hue Shift",
      updater: edit((effects) =>
        setEffectParameter(effects, "colorize", "_HueOffset", 0.25),
      ),
    });
    assert.equal(next, history);
  });
});

describe("layer FX bypass", () => {
  const LANES: FxLayer[] = [{ id: "1" }, { id: "5" }, { id: "6" }];

  it("defaults layers to on", () => {
    assert.ok(LANES.every((lane) => isLayerFxEnabled(lane)));
    assert.equal(getRenderedEffects(load(), LANES).length, load().length);
  });

  it("toggles one layer and skips no-op edits", () => {
    const off = setLaneFxEnabled(LANES, "6", false);
    assert.equal(off[2].fxEnabled, false);
    assert.equal(off[0], LANES[0]);
    assert.equal(setLaneFxEnabled(off, "6", false), off);
    assert.equal(setLaneFxEnabled(LANES, "6", true), LANES);
    assert.equal(setLaneFxEnabled(LANES, "missing", false), LANES);
    assert.ok(isLayerFxEnabled(setLaneFxEnabled(off, "6", true)[2]));
  });

  it("drops a bypassed layer's whole chain but keeps other stacks", () => {
    const effects = load();
    const lanes = setLaneFxEnabled(LANES, "6", false);
    const rendered = getRenderedEffects(effects, lanes);

    assert.deepEqual(ids(rendered, "6"), []);
    assert.deepEqual(resolveEffectChain(rendered, "6"), []);
    assert.deepEqual(ids(rendered, "1"), ["zoom"]);
    assert.deepEqual(ids(rendered, GLOBAL_EFFECT_TRACK_ID), ["layout"]);
    assert.ok(resolveEffectChain(effects, "6").length > 0);
  });

  it("keeps Layout anchoring on a bypassed layer", () => {
    const effects = addEffect(load(), "6", "Layout", 0, "layer-layout");
    const rendered = getRenderedEffects(
      effects,
      setLaneFxEnabled(LANES, "6", false),
    );
    assert.deepEqual(ids(rendered, "6"), ["layer-layout"]);
  });

  it("keeps the Color that paints fill clips on a bypassed layer", () => {
    const effects = addEffect(load(), "6", "Color", undefined, "fill-color");
    const rendered = getRenderedEffects(
      effects,
      setLaneFxEnabled(LANES, "6", false),
    );
    assert.deepEqual(ids(rendered, "6"), ["fill-color"]);
  });

  it("keeps the Text that styles text clips on a bypassed layer", () => {
    const effects = addEffect(load(), "6", "Text", undefined, "text-style");
    const rendered = getRenderedEffects(
      effects,
      setLaneFxEnabled(LANES, "6", false),
    );
    assert.deepEqual(ids(rendered, "6"), ["text-style"]);
  });

  it("restores each device's own bypass state when turned back on", () => {
    const effects = setEffectEnabled(load(), "negative", false);
    const lanes = setLaneFxEnabled(
      setLaneFxEnabled(LANES, "6", false),
      "6",
      true,
    );
    const rendered = getRenderedEffects(effects, lanes);
    assert.equal(rendered, effects);
    assert.deepEqual(
      resolveEffectChain(rendered, "6").map((step) => step.pass.effectName),
      ["Pixelate", "Colorize", "AnalogGlitch"],
    );
  });

  it("undoes and redoes the toggle as one labeled entry", () => {
    const initial = { lanes: LANES, effects: load() };
    let history = createProjectHistoryState(initial);
    const label = effectHistoryLabels.layerFx("Layer 3", false);
    assert.equal(label, "Turn FX Off for Layer 3");
    assert.equal(
      effectHistoryLabels.layerFx("Layer 3", true),
      "Turn FX On for Layer 3",
    );

    history = projectHistoryReducer(history, {
      type: "commit",
      label,
      updater: (current) => ({
        ...current,
        lanes: setLaneFxEnabled(current.lanes, "6", false),
      }),
    });
    const toggled = history.present;
    assert.equal(history.past[0].label, label);
    assert.equal(toggled.effects, initial.effects);

    history = projectHistoryReducer(history, { type: "undo" });
    assert.equal(history.present, initial);
    history = projectHistoryReducer(history, { type: "redo" });
    assert.equal(history.present, toggled);
  });
});

describe("Order devices", () => {
  function orderDevice(
    arrangement: string,
    activeLayerCount: number,
    enabled = true,
  ) {
    let effects = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Order", 0, "order");
    effects = setEffectParameter(effects, "order", "Arrangement", arrangement);
    effects = setEffectEnabled(effects, "order", enabled);
    return mapSessionEffectsToDevices(
      effects,
      "6",
      "Layer 3",
      activeLayerCount,
    ).find((device) => device.id === "order");
  }

  it("shows Grid Size only while the arrangement is Grid", () => {
    const keys = (arrangement: string) =>
      orderDevice(arrangement, 0)?.parameters.map((parameter) => parameter.key);
    assert.deepEqual(keys("Vertical"), ["Arrangement", "Spacing"]);
    assert.deepEqual(keys("Horizontal"), ["Arrangement", "Spacing"]);
    assert.deepEqual(keys("Grid"), ["Arrangement", "GridSize", "Spacing"]);
  });

  it("warns when a grid has fewer cells than active layers", () => {
    assert.equal(orderDevice("Grid", 4)?.warning, undefined);
    assert.equal(orderDevice("Grid", 5)?.warning, "1 layer hidden by grid");
    assert.equal(orderDevice("Grid", 7)?.warning, "3 layers hidden by grid");
    assert.equal(orderDevice("Vertical", 7)?.warning, undefined);
    assert.equal(orderDevice("Grid", 7, false)?.warning, undefined);
  });
});
