import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEffectChain } from "../../fx-shaders/registry.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "../../project-history.ts";
import { GLOBAL_EFFECT_TRACK_ID } from "./clip-stacks.ts";
import {
  type FxClip,
  type FxLayer,
  getRenderedEffects,
  isLayerFxEnabled,
  setLaneFxEnabled,
} from "./layer-fx.ts";
import { addEffect, effectHistoryLabels, setEffectEnabled } from "./ops.ts";
import { ids, load } from "./test-fixtures.ts";

describe("layer FX bypass", () => {
  const LANES: FxLayer[] = [{ id: "1" }, { id: "5" }, { id: "6" }];
  const CLIPS: FxClip[] = [
    { id: "v", laneId: "6" },
    { id: "f", laneId: "6", kind: "fill" },
    { id: "t", laneId: "6", kind: "text" },
    { id: "a", laneId: "6", kind: "fx" },
    { id: "other", laneId: "1" },
  ];

  it("defaults layers to on", () => {
    assert.ok(LANES.every((lane) => isLayerFxEnabled(lane)));
    assert.equal(
      getRenderedEffects(load(), LANES, CLIPS).length,
      load().length,
    );
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
    const rendered = getRenderedEffects(effects, lanes, CLIPS);

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
      CLIPS,
    );
    assert.deepEqual(ids(rendered, "6"), ["layer-layout"]);
  });

  it("keeps the Color that paints fill clips on a bypassed layer", () => {
    const effects = addEffect(load(), "6", "Color", undefined, "fill-color");
    const rendered = getRenderedEffects(
      effects,
      setLaneFxEnabled(LANES, "6", false),
      CLIPS,
    );
    assert.deepEqual(ids(rendered, "6"), ["fill-color"]);
  });

  it("keeps a text clip's own Text on a bypassed layer", () => {
    const effects = addEffect(
      load(),
      "clip:t",
      "Text",
      undefined,
      "text-style",
    );
    const rendered = getRenderedEffects(
      effects,
      setLaneFxEnabled(LANES, "6", false),
      CLIPS,
    );
    assert.deepEqual(ids(rendered, "clip:t"), ["text-style"]);
  });

  it("drops the effects of clips on a bypassed layer", () => {
    let effects = load();
    effects = addEffect(effects, "clip:v", "Pixelate", undefined, "v-fx");
    effects = addEffect(effects, "clip:f", "Color", undefined, "f-color");
    effects = addEffect(effects, "clip:f", "Colorize", undefined, "f-fx");
    effects = addEffect(effects, "clip:a", "Pixelate", undefined, "a-fx");
    effects = addEffect(effects, "clip:a", "Color", undefined, "a-color");
    effects = addEffect(effects, "clip:other", "Pixelate", undefined, "o-fx");
    assert.equal(effects.length, load().length + 6);
    const rendered = getRenderedEffects(
      effects,
      setLaneFxEnabled(LANES, "6", false),
      CLIPS,
    );

    assert.deepEqual(ids(rendered, "6"), []);
    assert.deepEqual(ids(rendered, "clip:v"), []);
    assert.deepEqual(ids(rendered, "clip:f"), ["f-color"]);
    assert.deepEqual(ids(rendered, "clip:a"), []);
    assert.deepEqual(resolveEffectChain(rendered, "clip:a"), []);
    assert.deepEqual(ids(rendered, "clip:other"), ["o-fx"]);
    assert.deepEqual(ids(rendered, "1"), ["zoom"]);
    assert.equal(getRenderedEffects(effects, LANES, CLIPS), effects);
  });

  it("never adds Text to a layer's own stack", () => {
    const effects = load();
    assert.equal(addEffect(effects, "6", "Text", undefined, "text"), effects);
  });

  it("restores each device's own bypass state when turned back on", () => {
    const effects = setEffectEnabled(load(), "negative", false);
    const lanes = setLaneFxEnabled(
      setLaneFxEnabled(LANES, "6", false),
      "6",
      true,
    );
    const rendered = getRenderedEffects(effects, lanes, CLIPS);
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
