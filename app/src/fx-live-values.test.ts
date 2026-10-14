import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lfoSwing, modulatedValue } from "./audio-mix/modulation.ts";
import {
  createDefaultAnimation,
  type EffectAnimation,
} from "./fx-animation-defaults.ts";
import {
  DEFAULT_REACTIVE_RANGE_SCALE,
  reactiveOffset,
} from "./fx-animation-impulse.ts";
import { resolveLfoParameters } from "./fx-animation-lfo.ts";
import { resolveReactiveParameters } from "./fx-animation-reactive.ts";
import {
  drivesKnob,
  type LiveDevice,
  type LiveTime,
  liveDriver,
  liveKnobValue,
} from "./fx-live-values.ts";
import {
  createDefaultModulation,
  type EffectModulation,
} from "./fx-modulation-defaults.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import {
  createEffect,
  GLOBAL_EFFECT_TRACK_ID,
  mapSessionEffectsToDevices,
} from "./fx-stack.ts";

const AT: LiveTime = { time: 0.25, bpm: 120, fps: 30 };

function device(
  effectName: string,
  id: string,
  changes: Partial<Pick<LiveDevice, "animation" | "modulation" | "enabled">>,
): LiveDevice {
  const effect = createEffect(GLOBAL_EFFECT_TRACK_ID, effectName, id);
  const [found] = mapSessionEffectsToDevices([effect], undefined).filter(
    (candidate) => candidate.id === id,
  );
  assert.ok(found, `no device for ${effectName}`);
  return { ...found, ...changes };
}

function splitAnimation(changes: Partial<EffectAnimation>): EffectAnimation {
  const animation = createDefaultAnimation("NegativeSplit");
  assert.ok(animation);
  return { ...animation, ...changes };
}

// A NegativeSplit with both knobs halfway, away from their neutral values
// and limits.
function split(changes: Partial<EffectAnimation>) {
  const live = device("NegativeSplit", "split-1", {
    animation: splitAnimation(changes),
  });
  return {
    ...live,
    parameters: live.parameters.map((parameter) => ({
      ...parameter,
      numericValue: 0.5,
    })),
  };
}

function stored(live: LiveDevice, key: string) {
  const parameter = live.parameters.find((candidate) => candidate.key === key);
  return parameter?.numericValue ?? Number(parameter?.defaultValue);
}

function asEffect(live: LiveDevice) {
  return {
    id: live.id,
    effectName: live.effectName,
    parameters: live.parameters.map((parameter) => ({
      key: parameter.key,
      value: String(stored(live, parameter.key)),
      numericValue: stored(live, parameter.key),
    })),
  };
}

function modulated(changes: Partial<EffectModulation>) {
  const modulation = createDefaultModulation("High Cut");
  assert.ok(modulation);
  return device("High Cut", "cut-1", {
    modulation: { ...modulation, ...changes },
  });
}

describe("live knob values", () => {
  it("leaves knobs alone while the modifier is off", () => {
    const off = split({ enabled: false, mode: "lfo" });
    assert.equal(liveDriver(off), undefined);
    assert.equal(liveKnobValue(off, undefined, "_LowIntensity", AT), undefined);
  });

  it("leaves a turned-off device's knobs alone", () => {
    const live = { ...split({ mode: "lfo" }), enabled: false };
    assert.equal(liveDriver(live), undefined);
  });

  it("follows Animation's LFO on its selected knobs only", () => {
    const base = split({ mode: "lfo" });
    const animation = base.animation;
    assert.ok(animation?.lfo);
    const live = {
      ...base,
      animation: {
        ...animation,
        lfo: {
          ...animation.lfo,
          sync: false,
          rate: 1,
          depth: 1,
          parameters: ["_LowIntensity"],
        },
      },
    };
    const driver = liveDriver(live);
    assert.equal(driver?.kind, "lfo");
    assert.equal(drivesKnob(driver, "_HighIntensity"), false);
    assert.equal(
      liveKnobValue(live, driver, "_HighIntensity", AT),
      undefined,
    );

    assert.ok(live.animation.lfo);
    const expected = resolveLfoParameters(asEffect(live), live.animation.lfo, {
      time: AT.time,
      bpm: AT.bpm,
    }).find((parameter) => parameter.key === "_LowIntensity")?.numericValue;
    const value = liveKnobValue(live, driver, "_LowIntensity", AT);
    assert.equal(value, expected);
    assert.notEqual(value, stored(live, "_LowIntensity"));
  });

  it("eases Clip mode in over the clip and is still outside it", () => {
    const live = split({ mode: "clip" });
    const driver = liveDriver(live);
    assert.equal(driver?.kind, "clip");
    const clipSpan = {
      startSeconds: 1,
      durationSeconds: 4,
      sessionEdges: { atStart: false, atEnd: false },
    };
    const easing = liveKnobValue(live, driver, "_LowIntensity", {
      ...AT,
      time: 1.05,
      clipSpan,
    });
    assert.ok(easing !== undefined);
    assert.ok(easing < stored(live, "_LowIntensity"));

    for (const time of [0.5, 3, 5.5]) {
      assert.equal(
        liveKnobValue(live, driver, "_LowIntensity", { ...AT, time, clipSpan }),
        undefined,
        `at ${time}s`,
      );
    }
    assert.equal(
      liveKnobValue(live, driver, "_LowIntensity", { ...AT, time: 1.05 }),
      undefined,
    );
  });

  it("swings Reactive's knobs on a hit and rests between hits", () => {
    const live = split({ mode: "reactive" });
    const driver = liveDriver(live);
    assert.equal(driver?.kind, "reactive");
    assert.equal(liveKnobValue(live, driver, "_LowIntensity", AT), undefined);

    const onsets = [{ time: 0.2, strength: 1 }];
    const reactive = live.animation?.reactive;
    assert.ok(reactive);
    const expected = resolveReactiveParameters(asEffect(live), reactive, {
      time: AT.time,
      fps: AT.fps,
      onsets,
    }).find((parameter) => parameter.key === "_LowIntensity")?.numericValue;
    const value = liveKnobValue(live, driver, "_LowIntensity", {
      ...AT,
      onsets,
    });
    assert.ok(value !== undefined);
    assert.equal(value, expected);
  });

  it("follows Modulation's LFO as the audio chain does", () => {
    const base = modulated({ mode: "lfo" });
    assert.ok(base.modulation);
    const live = {
      ...base,
      modulation: {
        ...base.modulation,
        lfo: { ...base.modulation.lfo, sync: false, rate: 1, depth: 1 },
      },
    };
    const driver = liveDriver(live);
    assert.equal(driver?.kind, "modulation");
    const [definition] = getEffectDefinition("High Cut").parameters.filter(
      (parameter) => parameter.key === "Frequency",
    );
    assert.ok(definition?.kind === "number");
    const expected = modulatedValue(
      stored(live, "Frequency"),
      lfoSwing(live.modulation.lfo, live.id, "Frequency", AT.time, {
        bpm: AT.bpm,
      }),
      {
        key: "Frequency",
        min: definition.min,
        max: definition.max,
        taper: definition.taper,
      },
    );
    assert.equal(liveKnobValue(live, driver, "Frequency", AT), expected);
  });

  it("follows the hit Transient last reported", () => {
    const live = modulated({ mode: "transient" });
    const driver = liveDriver(live);
    assert.equal(driver?.kind, "modulation");
    assert.equal(
      liveKnobValue(live, driver, "Frequency", {
        ...AT,
        transient: { level: 0, hit: 3 },
      }),
      undefined,
    );
    const [definition] = getEffectDefinition("High Cut").parameters.filter(
      (parameter) => parameter.key === "Frequency",
    );
    assert.ok(definition?.kind === "number");
    const expected = modulatedValue(
      stored(live, "Frequency"),
      reactiveOffset(live.id, "Frequency", 3) *
        0.5 *
        DEFAULT_REACTIVE_RANGE_SCALE,
      {
        key: "Frequency",
        min: definition.min,
        max: definition.max,
        taper: definition.taper,
      },
    );
    assert.equal(
      liveKnobValue(live, driver, "Frequency", {
        ...AT,
        transient: { level: 0.5, hit: 3 },
      }),
      expected,
    );
  });
});
