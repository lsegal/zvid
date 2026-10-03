import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultModulation,
  getModulatableParameters,
  normalizeEffectModulation,
  supportsModulation,
} from "./fx-modulation-defaults.ts";
import { FX_EFFECT_DEFINITIONS } from "./fx-registry.ts";
import {
  createEffect,
  duplicateEffect,
  resetEffect,
  type SessionEffect,
  setEffectAnimationEnabled,
  setEffectModulation,
  setEffectModulationEnabled,
} from "./fx-stack.ts";
import { migrateEffectModulation } from "./project-state-compat.ts";

describe("Modulation defaults", () => {
  it("covers every audio effect with knobs, each defaulting to knobs it has", () => {
    const audioEffects = FX_EFFECT_DEFINITIONS.filter(
      (definition) => definition.domain === "audio",
    ).map((definition) => definition.effectName);
    assert.ok(audioEffects.length > 10);
    for (const effectName of audioEffects) {
      const available = getModulatableParameters(effectName).map(
        (parameter) => parameter.key,
      );
      assert.equal(supportsModulation(effectName), available.length > 0);
      const modulation = createDefaultModulation(effectName);
      if (!modulation) {
        continue;
      }
      assert.equal(modulation.mode, "transient");
      assert.ok(modulation.transient.parameters.length > 0, effectName);
      for (const key of [
        ...modulation.transient.parameters,
        ...modulation.lfo.parameters,
      ]) {
        assert.ok(available.includes(key), `${effectName} has no ${key}`);
      }
    }
  });

  it("doesn't offer modulation on video effects", () => {
    assert.equal(supportsModulation("Pixelate"), false);
    assert.equal(createDefaultModulation("Pixelate"), undefined);
  });
});

describe("normalizeEffectModulation", () => {
  it("fills in what is missing or malformed from the defaults", () => {
    const defaults = createDefaultModulation("Delay");
    assert.ok(defaults);
    assert.deepEqual(
      normalizeEffectModulation(
        {
          enabled: true,
          mode: "LFO",
          transient: { reactivity: 4 },
          lfo: { shape: "saw up", rate: 500, phase: -10, syncRate: "1/7" },
        },
        "Delay",
      ),
      {
        enabled: true,
        mode: "lfo",
        transient: { ...defaults.transient, reactivity: 1 },
        lfo: {
          ...defaults.lfo,
          shape: "Saw Up",
          rate: 20,
          phase: 0,
        },
      },
    );
  });

  it("drops settings that aren't modulation, or on effects without it", () => {
    assert.equal(normalizeEffectModulation("on", "Delay"), undefined);
    assert.equal(
      normalizeEffectModulation({ enabled: true }, "Reverse"),
      undefined,
    );
  });
});

describe("Modulation edits", () => {
  const delay = () => createEffect("clip:a", "Delay", "delay");

  it("starts new audio effects without modulation", () => {
    assert.equal(delay().modulation, undefined);
  });

  it("turns on at the defaults, and keeps the settings when turned off", () => {
    const on = setEffectModulationEnabled([delay()], "delay", true);
    assert.deepEqual(on[0].modulation, createDefaultModulation("Delay"));

    const edited = setEffectModulation(on, "delay", {
      ...(on[0].modulation as NonNullable<SessionEffect["modulation"]>),
      mode: "lfo",
    });
    const off = setEffectModulationEnabled(edited, "delay", false);
    assert.equal(off[0].modulation?.enabled, false);
    assert.equal(off[0].modulation?.mode, "lfo");
    assert.equal(setEffectModulationEnabled(off, "delay", false), off);
  });

  it("leaves effects without modulation, and Animation, alone", () => {
    const pixelate = createEffect("lane", "Pixelate", "pixelate");
    const effects = [pixelate];
    assert.equal(
      setEffectModulationEnabled(effects, "pixelate", true),
      effects,
    );
    const audio = [delay()];
    assert.equal(setEffectAnimationEnabled(audio, "delay", true), audio);
  });

  it("copies modulation with a duplicate and drops it on a reset", () => {
    const on = setEffectModulationEnabled([delay()], "delay", true);
    const [original, copy] = duplicateEffect(on, "delay", "copy");
    assert.deepEqual(copy.modulation, original.modulation);
    assert.notEqual(copy.modulation, original.modulation);
    assert.notEqual(
      copy.modulation?.lfo.parameters,
      original.modulation?.lfo.parameters,
    );

    assert.equal(resetEffect(on, "delay")[0].modulation, undefined);
  });
});

describe("migrateEffectModulation", () => {
  it("leaves snapshots from before Modulation unchanged", () => {
    const effects = [createEffect("clip:a", "Delay", "delay")];
    assert.equal(migrateEffectModulation(effects), effects);
  });

  it("normalizes saved modulation and drops it where unsupported", () => {
    const [normalized, dropped] = migrateEffectModulation([
      {
        ...createEffect("clip:a", "Delay", "delay"),
        modulation: { enabled: true } as SessionEffect["modulation"],
      },
      {
        ...createEffect("clip:a", "Reverse", "reverse"),
        modulation: { enabled: true } as SessionEffect["modulation"],
      },
    ]);
    assert.deepEqual(normalized.modulation, {
      ...createDefaultModulation("Delay"),
      enabled: true,
    });
    assert.equal("modulation" in dropped, false);
  });
});
