import assert from "node:assert/strict";
import { test } from "node:test";
import { GAIN_KEY, MUTE_KEY } from "./fx/effects/gain/gain.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import {
  createEffect,
  type SessionEffect,
  sourceTrackEffectTrackId,
} from "./fx-stack.ts";
import {
  knobParameter,
  knobParameters,
  moveEffectKnob,
  moveEffectParameter,
  movePosition,
  moveTrackVolume,
} from "./midi-device-targets.ts";

const parameterValue = (effect: SessionEffect | undefined, key: string) =>
  effect?.parameters.find((parameter) => parameter.key === key)?.numericValue;

test("knobs drive an effect's numeric parameters in panel order", () => {
  const delay = createEffect("1", "Delay");
  const numbers = getEffectDefinition(delay.effectName).parameters.filter(
    (parameter) =>
      parameter.kind === "number" &&
      parameter.control !== "toggle" &&
      !parameter.hidden,
  );
  const keys = knobParameters(delay).map((parameter) => parameter.key);
  assert.ok(keys.length > 1);
  assert.deepEqual(
    keys,
    numbers
      .map((parameter) => parameter.key)
      .filter((key) => keys.includes(key)),
  );
});

test("a knob sets its parameter across the range", () => {
  const effect = createEffect("1", "Delay");
  const [first] = knobParameters(effect);
  assert.ok(first);
  for (const [to, value] of [
    [0, first.min],
    [1, first.max],
  ] as const) {
    const [moved] = moveEffectKnob([effect], effect.id, 0, { to });
    assert.equal(parameterValue(moved, first.key), value);
  }
});

test("a relative move goes from where the parameter is", () => {
  const effect = createEffect("1", "Delay");
  const [first] = knobParameters(effect);
  assert.ok(first);
  const [low] = moveEffectKnob([effect], effect.id, 0, { to: 0 });
  const [up] = moveEffectKnob([low as SessionEffect], effect.id, 0, {
    by: 0.5,
  });
  assert.ok((parameterValue(up, first.key) ?? first.min) > first.min);
  assert.ok((parameterValue(up, first.key) ?? first.max) < first.max);
});

test("knobs past the last parameter, or with nothing selected, do nothing", () => {
  const effects = [createEffect("1", "Delay")];
  assert.equal(moveEffectKnob(effects, effects[0]?.id, 99, { to: 1 }), effects);
  assert.equal(moveEffectKnob(effects, undefined, 0, { to: 1 }), effects);
});

test("toggles aren't knobs", () => {
  const keys = knobParameters(createEffect("1", "Gain")).map((p) => p.key);
  assert.deepEqual(keys, [GAIN_KEY]);
});

test("a track fader moves the track's Gain, adding one when it has none", () => {
  const stack = sourceTrackEffectTrackId("a");
  const moved = moveTrackVolume([], "a", { to: 1 });
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.trackId, stack);
  assert.equal(moved[0]?.effectName, "Gain");
  assert.equal(parameterValue(moved[0], GAIN_KEY), 10);
  const again = moveTrackVolume(moved, "a", { to: 0 });
  assert.equal(again.length, 1);
  assert.equal(again[0]?.id, moved[0]?.id);
  assert.ok((parameterValue(again[0], GAIN_KEY) as number) < 0);
});

test("positions stay within the travel", () => {
  assert.equal(movePosition(0.9, { by: 0.5 }), 1);
  assert.equal(movePosition(0.1, { by: -0.5 }), 0);
  assert.equal(movePosition(0.1, { to: 0.5 }), 0.5);
});

test("a mapped control moves its one parameter, unless it's gone", () => {
  const delay = createEffect("1", "Delay");
  const [first, second] = knobParameters(delay);
  assert.ok(first && second);
  assert.equal(knobParameter(delay, "nope"), undefined);
  const moved = moveEffectParameter([delay], delay.id, second.key, { to: 1 });
  assert.equal(parameterValue(moved[0], second.key), second.max);
  assert.equal(
    parameterValue(moved[0], first.key),
    parameterValue(delay, first.key),
  );
  const same = [delay];
  assert.equal(moveEffectParameter(same, delay.id, "nope", { to: 1 }), same);
  assert.equal(moveEffectParameter(same, "gone", second.key, { to: 1 }), same);
});

test("a toggle isn't a mappable knob", () => {
  const gain = createEffect("1", "Gain");
  assert.equal(knobParameter(gain, GAIN_KEY)?.key, GAIN_KEY);
  assert.equal(knobParameter(gain, MUTE_KEY), undefined);
});
