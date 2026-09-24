import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEffectDefinition } from "./fx-registry.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import {
  addEffect,
  effectHistoryLabels,
  GLOBAL_EFFECT_TRACK_ID,
  getRenderedEffects,
  isLayerFxEnabled,
  mapEffects,
  mapSessionEffectsToDevices,
  moveEffect,
  removeEffect,
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
// devices, and Layout sits on the global stack.
const DOGFOOD_EFFECTS: LvpSession["effects"] = [
  {
    id: "zoom",
    trackId: "1",
    effectName: "ZoomAndPan",
    parameters: {
      _Start_Zoom: { floatValue: 1 },
      _End_Zoom: { floatValue: 1.4 },
      _LAYERS_SelFrac: { floatValue: 0.5 },
    },
  },
  {
    id: "pixelate",
    trackId: "6",
    effectName: "Pixelate",
    parameters: {
      _NumPixels: { floatValue: 48 },
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
    const devices = mapSessionEffectsToDevices(load(), "6", "video");
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
    const devices = mapSessionEffectsToDevices(load(), "6", "video", "Layer 3");
    assert.equal(devices[0].subtitle, "Layer 3");
    assert.equal(devices[4].subtitle, "Global stack");
  });

  it("uses friendly labels and hides internal parameters", () => {
    const [zoom] = mapSessionEffectsToDevices(load(), "1", "video");
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
    assert.equal(zoom.parameters[3].display, "140%");

    const colorize = mapSessionEffectsToDevices(load(), "6", "video")[1];
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
    const layout = mapSessionEffectsToDevices(load(), "6", "video")[4];
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
    const devices = mapSessionEffectsToDevices(effects, "1", "video");
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

  it("adds a placeholder Layout device only for visual layers without one", () => {
    const layerOnly = load().filter(
      (effect) => effect.trackId !== GLOBAL_EFFECT_TRACK_ID,
    );
    const devices = mapSessionEffectsToDevices(layerOnly, "6", "video");
    assert.equal(devices[0].placeholder, true);
    assert.equal(devices[0].name, "Layout");
    assert.deepEqual(mapSessionEffectsToDevices([], "6", "audio"), []);
  });

  it("reports bypassed devices", () => {
    const effects = setEffectEnabled(load(), "colorize", false);
    const colorize = mapSessionEffectsToDevices(effects, "6", "video")[1];
    assert.equal(colorize.enabled, false);
  });

  it("treats a missing bypass flag as enabled", () => {
    const effects = load().map((effect) => ({
      ...effect,
      enabled: undefined as unknown as boolean,
    }));
    const devices = mapSessionEffectsToDevices(effects, "6", "video");
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

  it("toggles the bypass flag", () => {
    const effects = load();
    const next = setEffectEnabled(effects, "glitch", false);
    assert.equal(next.find((effect) => effect.id === "glitch")?.enabled, false);
    assert.equal(setEffectEnabled(effects, "glitch", true), effects);
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
      effectHistoryLabels.remove("AnalogGlitch"),
      "Remove Analog Glitch",
    );
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
  const LANES = [
    { id: "1", name: "Layer 1" },
    { id: "5", name: "Layer 2" },
    { id: "6", name: "Layer 3" },
  ];

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
      ["Colorize"],
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
