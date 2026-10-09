import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "../../project-history.ts";
import { clipEffectTrackId, GLOBAL_EFFECT_TRACK_ID } from "./clip-stacks.ts";
import {
  createEffect,
  ensureLayerLayouts,
  moveEffectToStack,
  removeEffect,
  setEffectEnabled,
  setEffectModulationEnabled,
  setEffectParameter,
} from "./ops.ts";
import { ids, load } from "./test-fixtures.ts";
import {
  canPlaceEffect,
  copyEffect,
  placeEffect,
  removeEffects,
} from "./transfer.ts";
import type { SessionEffect } from "./types.ts";

const CLIP = clipEffectTrackId("c1");

describe("copyEffect", () => {
  it("copies the settings under a new id and stack", () => {
    const [source] = setEffectEnabled(
      setEffectParameter(
        [createEffect("6", "Pixelate", "pixelate")],
        "pixelate",
        "_NumPixels",
        0.7,
      ),
      "pixelate",
      false,
    );
    const copy = copyEffect({ ...source, defaulted: true }, CLIP, "copy");

    assert.equal(copy.id, "copy");
    assert.equal(copy.trackId, CLIP);
    assert.equal(copy.enabled, false);
    assert.equal(copy.defaulted, undefined);
    assert.deepEqual(copy.parameters, source.parameters);
    assert.notEqual(copy.parameters[0], source.parameters[0]);
    assert.deepEqual(copy.animation, source.animation);
    assert.notEqual(copy.animation, source.animation);
  });

  it("copies modulation", () => {
    const [source] = setEffectModulationEnabled(
      [createEffect("6", "Gain", "gain")],
      "gain",
      true,
    );
    const copy = copyEffect(source, GLOBAL_EFFECT_TRACK_ID, "copy");

    assert.deepEqual(copy.modulation, source.modulation);
    assert.notEqual(copy.modulation, source.modulation);
  });
});

describe("placeEffect", () => {
  it("appends the effect to the end of its stack", () => {
    const effects = load();
    const copy = copyEffect(effects[1], "6", "copy");
    const next = placeEffect(effects, copy);

    assert.deepEqual(ids(next, "6"), [
      "pixelate",
      "colorize",
      "negative",
      "glitch",
      "copy",
    ]);
    assert.deepEqual(ids(next, "1"), ids(effects, "1"));
  });

  it("starts an empty stack", () => {
    const effects = load();
    const next = placeEffect(effects, copyEffect(effects[1], CLIP, "copy"));
    assert.deepEqual(ids(next, CLIP), ["copy"]);
  });

  it("refuses a stack the effect isn't designed for", () => {
    const effects = load();
    const reverse = createEffect(GLOBAL_EFFECT_TRACK_ID, "Reverse", "rev");
    assert.equal(placeEffect(effects, reverse), effects);
    assert.equal(
      placeEffect(effects, createEffect(CLIP, "Order", "order"), "clip"),
      effects,
    );
    assert.notEqual(
      placeEffect(effects, createEffect(CLIP, "Order", "order"), "fxClip"),
      effects,
    );
  });

  it("keeps one Layout per layer", () => {
    const effects = ensureLayerLayouts(load(), ["6", "1"]);
    const layout = effects.find((effect) => effect.id === "layout-6");
    assert.ok(layout);
    assert.equal(
      placeEffect(effects, copyEffect(layout, "1", "copy")),
      effects,
    );
    assert.equal(canPlaceEffect(effects, "Layout", "1"), false);
    assert.equal(canPlaceEffect(effects, "Layout", "7"), true);
  });

  it("bypasses the stack's Orders for an enabled Order", () => {
    const order = createEffect(GLOBAL_EFFECT_TRACK_ID, "Order", "order");
    const next = placeEffect([order], { ...order, id: "pasted" });

    assert.deepEqual(
      next.map((effect) => [effect.id, effect.enabled]),
      [
        ["order", false],
        ["pasted", true],
      ],
    );
    const bypassed = { ...order, id: "pasted", enabled: false };
    assert.equal(placeEffect([order], bypassed)[0], order);
  });

  it("refuses an id already in use", () => {
    const effects = load();
    assert.equal(
      placeEffect(effects, { ...effects[1], trackId: CLIP }),
      effects,
    );
  });
});

describe("removeEffects", () => {
  it("removes the effects but not a layer's own Layout", () => {
    const effects = ensureLayerLayouts(load(), ["6"]);
    const next = removeEffects(effects, [
      "layout-6",
      "pixelate",
      "colorize",
      "negative",
      "glitch",
    ]);
    assert.deepEqual(ids(next, "6"), ["layout-6"]);
    assert.deepEqual(ids(next, "1"), ids(effects, "1"));
  });

  it("returns the effects themselves when nothing is removed", () => {
    const effects = ensureLayerLayouts(load(), ["6"]);
    assert.equal(removeEffects(effects, ["layout-6", "missing"]), effects);
  });
});

describe("transfer history", () => {
  type State = { effects: SessionEffect[] };
  const edit =
    (updater: (effects: SessionEffect[]) => SessionEffect[]) =>
    (current: State) => {
      const effects = updater(current.effects);
      return effects === current.effects ? current : { effects };
    };

  it("undoes each cut, paste, move and clear as one step", () => {
    const initial: State = { effects: load() };
    const colorize = initial.effects.find((effect) => effect.id === "colorize");
    assert.ok(colorize);
    const steps: Array<(effects: SessionEffect[]) => SessionEffect[]> = [
      (effects) => removeEffect(effects, "colorize"),
      (effects) => placeEffect(effects, copyEffect(colorize, CLIP, "pasted")),
      (effects) =>
        moveEffectToStack(effects, "pixelate", GLOBAL_EFFECT_TRACK_ID),
      (effects) => removeEffects(effects, ["negative", "glitch", "pasted"]),
    ];
    let history = createProjectHistoryState(initial);
    const presents: State[] = [initial];
    for (const updater of steps) {
      history = projectHistoryReducer(history, {
        type: "commit",
        label: "Edit",
        updater: edit(updater),
      });
      presents.push(history.present);
    }
    assert.equal(history.past.length, steps.length);
    assert.deepEqual(ids(history.present.effects, "6"), []);

    for (let index = steps.length - 1; index >= 0; index -= 1) {
      history = projectHistoryReducer(history, { type: "undo" });
      assert.equal(history.present, presents[index]);
    }
  });
});
