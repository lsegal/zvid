import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEffectDefinition } from "../../fx-registry.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "../../project-history.ts";
import { clipEffectTrackId, GLOBAL_EFFECT_TRACK_ID } from "./clip-stacks.ts";
import { mapSessionEffectsToDevices } from "./devices.ts";
import {
  addEffect,
  createEffect,
  duplicateEffect,
  effectHistoryLabels,
  ensureGlobalOrder,
  ensureLayerLayouts,
  moveEffect,
  moveEffectToStack,
  pruneExcludedLayers,
  removeEffect,
  resetEffect,
  setEffectEnabled,
  setEffectParameter,
} from "./ops.ts";
import { ids, load } from "./test-fixtures.ts";
import type { SessionEffect } from "./types.ts";

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

describe("moveEffectToStack", () => {
  const clip = clipEffectTrackId("c1");
  function stacks() {
    return [
      ...load(),
      {
        id: "text",
        trackId: clip,
        effectName: "Text",
        parameters: [],
        enabled: true,
      },
      {
        id: "blur",
        trackId: clip,
        effectName: "GaussianBlur",
        parameters: [],
        enabled: true,
      },
    ] satisfies SessionEffect[];
  }

  it("moves an effect to another stack ahead of a device or at its end", () => {
    const effects = stacks();
    const before = moveEffectToStack(effects, "colorize", clip, "blur");
    assert.deepEqual(ids(before, clip), ["text", "colorize", "blur"]);
    assert.deepEqual(ids(before, "6"), ["pixelate", "negative", "glitch"]);
    assert.equal(before.length, effects.length);

    const end = moveEffectToStack(effects, "colorize", GLOBAL_EFFECT_TRACK_ID);
    assert.deepEqual(ids(end, GLOBAL_EFFECT_TRACK_ID), ["layout", "colorize"]);

    const back = moveEffectToStack(before, "colorize", "6", "negative");
    assert.deepEqual(ids(back, "6"), [
      "pixelate",
      "colorize",
      "negative",
      "glitch",
    ]);
  });

  it("keeps the effect's settings and drops its defaulted flag", () => {
    const effects = setEffectEnabled(
      setEffectParameter(stacks(), "colorize", "_HueOffset", -0.5),
      "colorize",
      false,
    ).map((effect) =>
      effect.id === "colorize" ? { ...effect, defaulted: true } : effect,
    );
    const original = effects.find((effect) => effect.id === "colorize");
    const moved = moveEffectToStack(effects, "colorize", clip).find(
      (effect) => effect.id === "colorize",
    );
    assert.ok(original?.defaulted);
    const { defaulted: _defaulted, ...settings } = original;
    assert.deepEqual(moved, { ...settings, trackId: clip });
  });

  it("rejects stacks the effect isn't designed for", () => {
    const effects = [
      ...stacks(),
      {
        id: "move",
        trackId: "6",
        effectName: "Transform",
        parameters: [],
        enabled: true,
      },
    ] satisfies SessionEffect[];
    assert.equal(
      moveEffectToStack(effects, "move", GLOBAL_EFFECT_TRACK_ID),
      effects,
    );
    // The Clip stack of an FX clip takes Order; a plain clip's doesn't.
    const order = [
      ...effects,
      {
        id: "order",
        trackId: GLOBAL_EFFECT_TRACK_ID,
        effectName: "Order",
        parameters: [],
        enabled: true,
      },
    ] satisfies SessionEffect[];
    assert.equal(moveEffectToStack(order, "order", clip), order);
    assert.deepEqual(
      ids(moveEffectToStack(order, "order", clip, undefined, "fxClip"), clip),
      ["text", "blur", "order"],
    );
  });

  it("keeps the content effects that define a layer or clip in place", () => {
    const effects = stacks();
    assert.equal(moveEffectToStack(effects, "text", "6"), effects);
    assert.equal(moveEffectToStack(effects, "layout", "6"), effects);
  });

  it("ignores moves within the stack, to a missing device, or of no effect", () => {
    const effects = stacks();
    assert.equal(moveEffectToStack(effects, "colorize", "6"), effects);
    assert.equal(moveEffectToStack(effects, "colorize", clip, "gone"), effects);
    assert.equal(moveEffectToStack(effects, "gone", clip), effects);
  });

  it("bypasses the Orders already on the stack an Order moves to", () => {
    const fxClip = clipEffectTrackId("fx");
    const effects = [
      {
        id: "global-order",
        trackId: GLOBAL_EFFECT_TRACK_ID,
        effectName: "Order",
        parameters: [],
        enabled: true,
      },
      {
        id: "clip-order",
        trackId: fxClip,
        effectName: "Order",
        parameters: [],
        enabled: true,
      },
    ] satisfies SessionEffect[];
    const next = moveEffectToStack(
      effects,
      "global-order",
      fxClip,
      "clip-order",
      "fxClip",
    );
    assert.deepEqual(ids(next, fxClip), ["global-order", "clip-order"]);
    assert.deepEqual(
      next.map((effect) => effect.enabled),
      [true, false],
    );
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
      { key: "ExcludedLayers", value: "" },
      { key: "GridSize", value: "2.000", numericValue: 2 },
      { key: "Spacing", value: "0.000", numericValue: 0 },
      { key: "Margin", value: "0.000", numericValue: 0 },
      { key: "BorderColor", value: "rgba(0,0,0,1)" },
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

describe("Zoom & Pan defaults", () => {
  function knobs(effects: SessionEffect[], trackId: string) {
    const device = mapSessionEffectsToDevices(effects, trackId).find(
      (candidate) => candidate.effectName === "ZoomAndPan",
    );
    return Object.fromEntries(
      (device?.parameters ?? []).map((parameter) => [
        parameter.label,
        parameter.display,
      ]),
    );
  }

  const DEFAULT_KNOBS = {
    "Start Zoom": "1.00×",
    "Start X": "50%",
    "Start Y": "50%",
    "End Zoom": "1.20×",
    "End X": "50%",
    "End Y": "50%",
  };

  it("zooms a new device in from 1.00x to 1.20x, centered", () => {
    const effect = createEffect("1", "ZoomAndPan", "zoom");
    assert.deepEqual(knobs([effect], "1"), DEFAULT_KNOBS);
    const endZoom = effect.parameters.find(
      (parameter) => parameter.key === "_End_Zoom",
    );
    assert.equal(endZoom?.numericValue, 0.2 / 3);
  });

  it("puts End Zoom's default on a knob step", () => {
    const definition = getEffectDefinition("ZoomAndPan").parameters.find(
      (parameter) => parameter.key === "_End_Zoom",
    );
    assert.ok(definition?.kind === "number" && definition.step);
    const steps = definition.defaultValue / definition.step;
    assert.equal(Math.round(steps), 20);
    assert.ok(Math.abs(steps - 20) < 1e-9);
  });

  it("restores the defaults on reset", () => {
    const edited = setEffectParameter(
      setEffectParameter(
        [createEffect("1", "ZoomAndPan", "zoom")],
        "zoom",
        "_End_Zoom",
        0.5,
      ),
      "zoom",
      "_Start_X",
      0.1,
    );
    assert.equal(knobs(edited, "1")["End Zoom"], "2.50×");
    assert.deepEqual(knobs(resetEffect(edited, "zoom"), "1"), DEFAULT_KNOBS);
  });

  it("keeps a loaded session's saved zoom", () => {
    const effects = load();
    assert.equal(knobs(effects, "1")["Start Zoom"], "1.00×");
    assert.equal(knobs(effects, "1")["End Zoom"], "1.69×");
    assert.equal(
      effects
        .find((effect) => effect.id === "zoom")
        ?.parameters.find((parameter) => parameter.key === "_End_Zoom")
        ?.numericValue,
      0.23,
    );
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
        "Move Negative Split",
        (effects) =>
          moveEffectToStack(effects, "negative", GLOBAL_EFFECT_TRACK_ID),
      ],
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

describe("pruneExcludedLayers", () => {
  it("drops excluded ids of layers that no longer exist", () => {
    let effects = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Order", 0, "order");
    effects = setEffectParameter(effects, "order", "ExcludedLayers", "1,3,7");
    const pruned = pruneExcludedLayers(effects, ["1", "2", "3"]);
    assert.equal(
      pruned[0].parameters.find(
        (parameter) => parameter.key === "ExcludedLayers",
      )?.value,
      "1,3",
    );
  });

  it("keeps effects with nothing to drop as they are", () => {
    let effects = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Order", 0, "order");
    effects = setEffectParameter(effects, "order", "ExcludedLayers", "2");
    effects = addEffect(effects, "2", "Colorize", 0, "colorize");
    const pruned = pruneExcludedLayers(effects, ["1", "2"]);
    assert.equal(pruned[0], effects[0]);
    assert.equal(pruned[1], effects[1]);
  });
});

describe("ensureGlobalOrder", () => {
  it("adds a Vertical Order at the start of the Global stack", () => {
    const effects = ensureGlobalOrder(
      addEffect(
        addEffect([], GLOBAL_EFFECT_TRACK_ID, "Colorize", 0, "colorize"),
        "1",
        "Colorize",
        0,
        "layer",
      ),
    );
    const global = effects.filter(
      (effect) => effect.trackId === GLOBAL_EFFECT_TRACK_ID,
    );
    assert.deepEqual(
      global.map((effect) => effect.id),
      ["order-global", "colorize"],
    );
    assert.equal(global[0].effectName, "Order");
    assert.equal(
      global[0].parameters.find((parameter) => parameter.key === "Arrangement")
        ?.value,
      "Vertical",
    );
  });

  it("returns the same array when the Global stack has an Order", () => {
    const withOrder = ensureGlobalOrder([]);
    assert.equal(ensureGlobalOrder(withOrder), withOrder);
    const bypassed = setEffectEnabled(withOrder, "order-global", false);
    assert.equal(ensureGlobalOrder(bypassed), bypassed);
  });

  it("does not count an Order on a layer's stack", () => {
    const effects: SessionEffect[] = [
      {
        id: "stray",
        trackId: "1",
        effectName: "Order",
        parameters: [],
        enabled: true,
      },
    ];
    assert.equal(
      ensureGlobalOrder(effects).filter(
        (effect) =>
          effect.trackId === GLOBAL_EFFECT_TRACK_ID &&
          effect.effectName === "Order",
      ).length,
      1,
    );
  });
});
