import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ArrangementClip,
  computeActiveClips,
} from "./composition-active-clips.ts";
import { resolveAnimatedEffects } from "./fx-animation.ts";
import {
  createDefaultAnimation,
  DEFAULT_REACTIVE_FRAMES,
  describeAnimatedParameters,
  type EffectAnimation,
  getAnimatableParameters,
  getAnimationDefaults,
  getClipTimingFrames,
  getReactiveTimingFrames,
  normalizeEffectAnimation,
  supportsAnimation,
  toggleAnimatedParameter,
} from "./fx-animation-defaults.ts";
import {
  animationCollapseKey,
  readCollapsedDevices,
  toggleCollapsedDevice,
  writeCollapsedDevices,
} from "./fx-chain.ts";
import { FX_EFFECT_DEFINITIONS, getEffectDefinition } from "./fx-registry.ts";
import {
  addEffect,
  clipEffectTrackId,
  copyClipEffects,
  createEffect,
  duplicateEffect,
  effectHistoryLabels,
  ensureGlobalOrder,
  GLOBAL_EFFECT_TRACK_ID,
  mapEffects,
  mapSessionEffectsToDevices,
  resetEffect,
  type SessionEffect,
  setEffectAnimation,
  setEffectAnimationEnabled,
  setEffectEnabled,
} from "./fx-stack.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";

const KNOWN_EFFECTS = FX_EFFECT_DEFINITIONS.filter(
  (definition) => definition.known,
).map((definition) => definition.effectName);

function animated(effect: SessionEffect) {
  return setEffectAnimationEnabled([effect], effect.id, true)[0];
}

// An effect as saved before Animation existed: no animation at all.
function legacy(effect: SessionEffect): SessionEffect {
  const { animation: _animation, ...rest } = effect;
  return rest;
}

describe("animation support", () => {
  it("is on every known effect except Layout", () => {
    assert.ok(KNOWN_EFFECTS.length > 1);
    for (const effectName of KNOWN_EFFECTS) {
      assert.equal(
        supportsAnimation(effectName),
        effectName !== "Layout",
        effectName,
      );
    }
  });

  it("is off for effects the app doesn't know", () => {
    assert.equal(supportsAnimation("Mystery"), false);
    assert.equal(createDefaultAnimation("Mystery"), undefined);
  });

  it("shows the Animation toggle on every device but Layout", () => {
    const effects = KNOWN_EFFECTS.map((effectName) =>
      createEffect("6", effectName, effectName),
    );
    const devices = mapSessionEffectsToDevices(effects, "6", "Layer 3");
    assert.equal(devices.length, KNOWN_EFFECTS.length);
    for (const device of devices) {
      assert.equal(
        device.supportsAnimation,
        device.effectName !== "Layout",
        device.effectName,
      );
    }
  });
});

describe("animation defaults", () => {
  it("follows the suggested table", () => {
    assert.deepEqual(getAnimationDefaults("Order")?.clip, {
      motionIn: "Ease Out",
      motionOut: "Ease In",
      timing: "Normal",
    });
    assert.deepEqual(getAnimationDefaults("Order")?.clipFrames, {
      Slow: 7,
      Normal: 5,
      Fast: 3,
    });
    assert.deepEqual(getAnimationDefaults("ZoomAndPan")?.clip, {
      motionIn: "Ease In Out",
      motionOut: "Ease In Out",
      timing: "Normal",
    });
    assert.equal(getAnimationDefaults("Move")?.clip.motionIn, "Linear");
    assert.equal(getAnimationDefaults("Move")?.reactive.motion, "Wobble");
    assert.equal(
      getAnimationDefaults("AnalogGlitch")?.reactive.reactivity,
      0.6,
    );
    assert.deepEqual(getAnimationDefaults("Transform")?.reactive.parameters, [
      "ScaleX",
      "ScaleY",
    ]);
    assert.deepEqual(getAnimationDefaults("Text")?.reactive.parameters, [
      "FontSize",
      "LetterSpacing",
    ]);
  });

  it("modulates only knobs of the effect by default", () => {
    for (const effectName of KNOWN_EFFECTS.filter(supportsAnimation)) {
      const knobs = getAnimatableParameters(effectName).map(
        (parameter) => parameter.key,
      );
      for (const key of getAnimationDefaults(effectName)?.reactive.parameters ??
        []) {
        assert.ok(knobs.includes(key), `${effectName} ${key}`);
      }
    }
  });

  it("times Clip and Reactive animations in frames", () => {
    assert.equal(getClipTimingFrames("Transform", "Slow"), 12);
    assert.equal(getClipTimingFrames("Pixelate", "Fast"), 3);
    assert.equal(getClipTimingFrames("Layout", "Normal"), undefined);
    assert.equal(getReactiveTimingFrames("Colorize", "Slow"), 18);
    assert.equal(getReactiveTimingFrames("Colorize", "Normal"), 12);
    assert.equal(getReactiveTimingFrames("Colorize", "Fast"), 6);
    assert.deepEqual(DEFAULT_REACTIVE_FRAMES, {
      Slow: 18,
      Normal: 12,
      Fast: 6,
    });
  });

  it("starts in Clip mode, on, with the effect's defaults", () => {
    assert.deepEqual(createDefaultAnimation("Pixelate"), {
      enabled: true,
      mode: "clip",
      clip: { motionIn: "Ease Out", motionOut: "Ease In", timing: "Normal" },
      reactive: {
        motion: "Bounce",
        timing: "Normal",
        reactivity: 0.5,
        parameters: ["_NumPixels"],
      },
    });
  });

  it("hands out copies that don't share the defaults", () => {
    const animation = createDefaultAnimation("Order");
    animation?.reactive.parameters.push("GridSize");
    assert.deepEqual(createDefaultAnimation("Order")?.reactive.parameters, [
      "Spacing",
    ]);
  });
});

describe("getAnimatableParameters", () => {
  it("lists only knob parameters", () => {
    for (const effectName of KNOWN_EFFECTS) {
      const knobKeys = getEffectDefinition(effectName)
        .parameters.filter(
          (parameter) => parameter.kind === "number" && !parameter.hidden,
        )
        .map((parameter) => parameter.key);
      assert.deepEqual(
        getAnimatableParameters(effectName).map((parameter) => parameter.key),
        knobKeys,
        effectName,
      );
    }
  });

  it("leaves out menus, colors, text and hidden parameters", () => {
    assert.deepEqual(getAnimatableParameters("Order"), [
      { key: "GridSize", label: "Grid Size" },
      { key: "Spacing", label: "Spacing" },
    ]);
    const zoom = getAnimatableParameters("ZoomAndPan").map(
      (parameter) => parameter.key,
    );
    assert.ok(!zoom.includes("_LAYERS_SelFrac"));
    const text = getAnimatableParameters("Text").map(
      (parameter) => parameter.key,
    );
    for (const key of ["Text", "FontFamily", "Align", "Color", "Gradient"]) {
      assert.ok(!text.includes(key), key);
    }
    assert.deepEqual(getAnimatableParameters("Color"), [
      { key: "Opacity", label: "Opacity" },
    ]);
    assert.deepEqual(getAnimationDefaults("Color")?.reactive.parameters, [
      "Opacity",
    ]);
  });

  it("labels the Parameters button with how many knobs are modulated", () => {
    const available = getAnimatableParameters("NegativeSplit");
    assert.equal(
      describeAnimatedParameters(["_LowIntensity"], available),
      "Parameters: 1 of 2",
    );
    // Keys the effect doesn't have as knobs don't count.
    assert.equal(
      describeAnimatedParameters(["_LowIntensity", "Gone"], available),
      "Parameters: 1 of 2",
    );
  });

  it("toggles a parameter in the effect's knob order", () => {
    const available = getAnimatableParameters("Pixelate");
    assert.deepEqual(
      toggleAnimatedParameter(["_HighIntensity"], "_NumPixels", available),
      ["_NumPixels", "_HighIntensity"],
    );
    assert.deepEqual(
      toggleAnimatedParameter(
        ["_NumPixels", "_HighIntensity"],
        "_NumPixels",
        available,
      ),
      ["_HighIntensity"],
    );
  });
});

describe("setEffectAnimationEnabled", () => {
  it("applies the effect's defaults when first turned on", () => {
    const effect = legacy(createEffect("6", "Colorize", "colorize"));
    assert.equal(effect.animation, undefined);
    assert.deepEqual(
      animated(effect).animation,
      createDefaultAnimation("Colorize"),
    );
  });

  it("keeps the settings when turned off, and brings them back on", () => {
    const [effect] = setEffectAnimation(
      [animated(createEffect("6", "Colorize", "colorize"))],
      "colorize",
      {
        ...(createDefaultAnimation("Colorize") as EffectAnimation),
        mode: "reactive",
      },
    );
    const [off] = setEffectAnimationEnabled([effect], "colorize", false);
    assert.equal(off.animation?.enabled, false);
    assert.equal(off.animation?.mode, "reactive");
    const [on] = setEffectAnimationEnabled([off], "colorize", true);
    assert.equal(on.animation?.enabled, true);
    assert.equal(on.animation?.mode, "reactive");
  });

  it("leaves Layout, unknown effects and no-op toggles alone", () => {
    const effects = [
      createEffect("6", "Layout", "layout"),
      createEffect("6", "Mystery", "mystery"),
      createEffect("6", "Pixelate", "pixelate"),
    ];
    assert.equal(setEffectAnimationEnabled(effects, "layout", true), effects);
    assert.equal(setEffectAnimationEnabled(effects, "mystery", true), effects);
    assert.equal(setEffectAnimationEnabled(effects, "pixelate", true), effects);
    assert.equal(setEffectAnimationEnabled(effects, "missing", true), effects);
  });

  it("is kept apart from the device's own bypass", () => {
    const effect = animated(createEffect("6", "Pixelate", "pixelate"));
    const [bypassed] = setEffectEnabled([effect], "pixelate", false);
    assert.equal(bypassed.animation?.enabled, true);
    const [reset] = resetEffect([bypassed], "pixelate");
    assert.equal(reset.enabled, true);
    assert.deepEqual(reset.animation, effect.animation);
  });
});

describe("setEffectAnimation", () => {
  it("switches the mode and keeps both modes' fields", () => {
    const effect = animated(createEffect("6", "Transform", "transform"));
    const animation = effect.animation as EffectAnimation;
    const [reactive] = setEffectAnimation([effect], "transform", {
      ...animation,
      mode: "reactive",
      reactive: { ...animation.reactive, reactivity: 0.8 },
    });
    assert.equal(reactive.animation?.mode, "reactive");
    assert.equal(reactive.animation?.reactive.reactivity, 0.8);
    assert.deepEqual(reactive.animation?.clip, animation.clip);
  });

  it("returns the same effects when nothing changed", () => {
    const effects = [animated(createEffect("6", "Order", "order"))];
    assert.equal(
      setEffectAnimation(
        effects,
        "order",
        effects[0].animation as EffectAnimation,
      ),
      effects,
    );
  });

  it("clamps and cleans the settings it is given", () => {
    const effects = [animated(createEffect("6", "Order", "order"))];
    const animation = effects[0].animation as EffectAnimation;
    const [next] = setEffectAnimation(effects, "order", {
      ...animation,
      reactive: {
        ...animation.reactive,
        reactivity: 4,
        parameters: ["Spacing", "Spacing", "GridSize"],
      },
    });
    assert.equal(next.animation?.reactive.reactivity, 1);
    assert.deepEqual(next.animation?.reactive.parameters, [
      "Spacing",
      "GridSize",
    ]);
  });

  it("is labeled for history", () => {
    assert.equal(
      effectHistoryLabels.animationEnabled("NegativeSplit", true),
      "Turn Animation On for Negative Split",
    );
    assert.equal(
      effectHistoryLabels.animationEnabled("Order", false),
      "Turn Animation Off for Order",
    );
    assert.equal(
      effectHistoryLabels.animation("ZoomAndPan"),
      "Change Zoom & Pan Animation",
    );
  });

  it("is undone and redone like any effect edit", () => {
    type State = { effects: SessionEffect[] };
    const initial: State = {
      effects: [createEffect("6", "Pixelate", "pixelate")],
    };
    let history = createProjectHistoryState(initial);
    history = projectHistoryReducer(history, {
      type: "commit",
      label: effectHistoryLabels.animationEnabled("Pixelate", true),
      updater: (current) => ({
        effects: setEffectAnimationEnabled(current.effects, "pixelate", true),
      }),
    });
    assert.equal(history.present.effects[0].animation?.enabled, true);
    history = projectHistoryReducer(history, { type: "undo" });
    assert.equal(history.present, initial);
    history = projectHistoryReducer(history, { type: "redo" });
    assert.equal(history.present.effects[0].animation?.enabled, true);
  });
});

describe("normalizeEffectAnimation", () => {
  it("fills in missing and malformed fields from the defaults", () => {
    assert.deepEqual(
      normalizeEffectAnimation(
        {
          enabled: true,
          mode: "Reactive",
          clip: { motionIn: "linear", timing: "Warp" },
          reactive: { reactivity: "high", parameters: ["_HueOffset", 3] },
        },
        "Colorize",
      ),
      {
        enabled: true,
        mode: "reactive",
        clip: { motionIn: "Linear", motionOut: "Ease In", timing: "Normal" },
        reactive: {
          motion: "Wobble",
          timing: "Normal",
          reactivity: 0.5,
          parameters: ["_HueOffset"],
        },
      },
    );
  });

  it("reads nothing for a missing value or an effect without support", () => {
    assert.equal(normalizeEffectAnimation(undefined, "Colorize"), undefined);
    assert.equal(normalizeEffectAnimation("on", "Colorize"), undefined);
    assert.equal(
      normalizeEffectAnimation(createDefaultAnimation("Order"), "Layout"),
      undefined,
    );
  });
});

describe("animation on new devices", () => {
  it("is on, at the effect's defaults, for every effect that supports it", () => {
    for (const effectName of KNOWN_EFFECTS.filter(supportsAnimation)) {
      const effect = createEffect("6", effectName, "e");
      assert.equal(effect.animation?.enabled, true, effectName);
      assert.equal(effect.animation?.mode, "clip", effectName);
      assert.deepEqual(
        effect.animation,
        createDefaultAnimation(effectName),
        effectName,
      );
    }
  });

  it("comes with a device added to a stack", () => {
    for (const effectName of ["Colorize", "Transform", "Pixelate"]) {
      const [effect] = addEffect([], "6", effectName, undefined, "e");
      assert.deepEqual(
        effect.animation,
        createDefaultAnimation(effectName),
        effectName,
      );
    }
    const [order] = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Order", 0, "o");
    assert.deepEqual(order.animation, createDefaultAnimation("Order"));
  });

  it("comes with a new session's default Order", () => {
    const [order] = ensureGlobalOrder([]);
    assert.equal(order.effectName, "Order");
    assert.deepEqual(order.animation, createDefaultAnimation("Order"));
  });

  it("is absent on Layout and effects the app doesn't know", () => {
    assert.equal("animation" in createEffect("6", "Layout", "l"), false);
    assert.equal("animation" in createEffect("6", "Mystery", "m"), false);
  });

  it("is turned on for a duplicate of a device saved without it", () => {
    const effects = [legacy(createEffect("6", "Colorize", "colorize"))];
    const duplicated = duplicateEffect(effects, "colorize", "copy");
    const copy = duplicated.find((effect) => effect.id === "copy");
    assert.deepEqual(copy?.animation, createDefaultAnimation("Colorize"));
    assert.equal(duplicated[0], effects[0]);
  });

  it("stays off on a duplicate of a device saved with it off", () => {
    const effects = setEffectAnimationEnabled(
      [createEffect("6", "Colorize", "colorize")],
      "colorize",
      false,
    );
    const duplicated = duplicateEffect(effects, "colorize", "copy");
    const copy = duplicated.find((effect) => effect.id === "copy");
    assert.equal(copy?.animation?.enabled, false);
  });

  it("is turned back on, at the defaults, by a reset", () => {
    const [changed] = setEffectAnimation(
      setEffectAnimationEnabled(
        [createEffect("6", "Transform", "t")],
        "t",
        false,
      ),
      "t",
      {
        ...(createDefaultAnimation("Transform") as EffectAnimation),
        enabled: false,
        mode: "reactive",
      },
    );
    const [reset] = resetEffect([changed], "t");
    assert.deepEqual(reset.animation, createDefaultAnimation("Transform"));
    const [legacyReset] = resetEffect(
      [legacy(createEffect("6", "Transform", "t"))],
      "t",
    );
    assert.deepEqual(
      legacyReset.animation,
      createDefaultAnimation("Transform"),
    );
  });

  it("leaves a reset of a device already at its defaults unchanged", () => {
    const effects = [createEffect("6", "Transform", "t")];
    assert.equal(resetEffect(effects, "t"), effects);
    const layouts = [createEffect("6", "Layout", "l")];
    assert.equal(resetEffect(layouts, "l"), layouts);
  });

  it("keeps a saved setting, and leaves a device saved without it off", () => {
    const [off, plain] = mapEffects([
      {
        id: "off",
        trackId: "6",
        effectName: "Colorize",
        parameters: {},
        animation: {
          ...(createDefaultAnimation("Colorize") as EffectAnimation),
          enabled: false,
        },
      },
      {
        id: "plain",
        trackId: "6",
        effectName: "Colorize",
        parameters: {},
      },
    ]);
    assert.equal(off.animation?.enabled, false);
    assert.equal(plain.animation, undefined);
    const [device] = mapSessionEffectsToDevices([plain], "6", "Layer 3");
    assert.equal(device.animation?.enabled === true, false);
  });
});

describe("animation in a device's life", () => {
  it("loads from a session, and sessions without it load as before", () => {
    const [plain, withAnimation] = mapEffects([
      {
        id: "plain",
        trackId: "6",
        effectName: "Pixelate",
        parameters: { _NumPixels: { floatValue: 0.4 } },
      },
      {
        id: "animated",
        trackId: "6",
        effectName: "Pixelate",
        parameters: {},
        animation: createDefaultAnimation("Pixelate"),
      },
    ]);
    assert.equal("animation" in plain, false);
    assert.deepEqual(
      withAnimation.animation,
      createDefaultAnimation("Pixelate"),
    );
  });

  it("is carried by a duplicated device, as its own copy", () => {
    const effects = [animated(createEffect("6", "Order", "order"))];
    const duplicated = duplicateEffect(effects, "order", "copy");
    const copy = duplicated.find((effect) => effect.id === "copy");
    assert.deepEqual(copy?.animation, effects[0].animation);
    assert.notEqual(copy?.animation, effects[0].animation);
    assert.notEqual(
      copy?.animation?.reactive.parameters,
      effects[0].animation?.reactive.parameters,
    );
  });

  it("is carried by a copied clip stack", () => {
    const effects = [
      animated(createEffect(clipEffectTrackId("a"), "Transform", "t")),
    ];
    let next = 0;
    const copied = copyClipEffects(
      effects,
      [["a", "b"]],
      effects,
      () => `copy-${++next}`,
    );
    const copy = copied.find(
      (effect) => effect.trackId === clipEffectTrackId("b"),
    );
    assert.deepEqual(copy?.animation, effects[0].animation);
    assert.notEqual(copy?.animation, effects[0].animation);
  });

  it("shows on the device", () => {
    const effect = animated(createEffect("6", "Colorize", "colorize"));
    const [device] = mapSessionEffectsToDevices([effect], "6", "Layer 3");
    assert.deepEqual(device.animation, effect.animation);
  });
});

describe("animation section collapse", () => {
  it("is stored with the devices' collapse state and persists", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const key = animationCollapseKey("order");
    assert.notEqual(key, "order");
    writeCollapsedDevices(storage, toggleCollapsedDevice(new Set(), key));
    const restored = readCollapsedDevices(storage);
    assert.ok(restored.has(key));
    assert.ok(!restored.has("order"));
  });
});

describe("resolveAnimatedEffects", () => {
  const clipContext = {
    clipId: "c",
    laneId: "6",
    progress: 0.5,
    elapsedSeconds: 1,
    durationSeconds: 2,
  };
  const frameContext = { playheadQ: 4, bpm: 120, fps: 30 };

  // Clip mode animates only as a clip enters and exits (see
  // fx-animation-clip.test.ts), so mid-clip every effect is drawn as set.
  it("draws every effect with its parameters as they are mid-clip", () => {
    const effects = [
      animated(createEffect("6", "Pixelate", "pixelate")),
      createEffect("6", "Colorize", "colorize"),
    ];
    assert.equal(
      resolveAnimatedEffects(effects, clipContext, frameContext),
      effects,
    );
  });

  it("changes no rendering mid-clip with animation on", () => {
    const clip: ArrangementClip = {
      id: "fill-1",
      kind: "fill",
      sourceTrackId: "",
      laneId: "6",
      label: "Fill",
      mediaPath: "",
      startQ: 0,
      durationSeconds: 4,
      trimStartSeconds: 0,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 4,
      tint: "#000",
      accent: "#fff",
    };
    const plain = [
      createEffect("6", "Transform", "transform"),
      createEffect("6", "Pixelate", "pixelate"),
      createEffect("6", "Color", "color"),
    ];
    const withAnimation = plain.map(animated);
    const render = (effects: SessionEffect[]) =>
      computeActiveClips(
        [clip],
        new Map(),
        2,
        120,
        new Map([["6", 0]]),
        effects,
      );
    const off = render(plain);
    const on = render(withAnimation);
    assert.equal(on.length, 1);
    assert.deepEqual(on[0].visual, off[0].visual);
    assert.deepEqual(on[0].effectChain, off[0].effectChain);
    assert.deepEqual(on[0].fill, off[0].fill);
  });

  // 0.1 s after a full-strength hit in both bands.
  const hitFrame = {
    ...frameContext,
    audio: {
      low: 1,
      high: 1,
      impulseLow: 1,
      impulseHigh: 1,
      onsets: [{ secondsAgo: 0.1, strength: 1 }],
    },
  };
  const quietFrame = {
    ...frameContext,
    audio: { ...hitFrame.audio, impulseLow: 0, impulseHigh: 0, onsets: [] },
  };
  const audioEffects = [
    "Colorize",
    "Pixelate",
    "NegativeSplit",
    "AnalogGlitch",
  ];

  function withMode(
    effectName: string,
    enabled: boolean,
    mode: EffectAnimation["mode"],
  ) {
    const effect = createEffect("6", effectName, effectName);
    const animation = createDefaultAnimation(effectName);
    assert.ok(animation);
    return { ...effect, animation: { ...animation, enabled, mode } };
  }

  it("ignores audio hits with animation off", () => {
    const effects = audioEffects.flatMap((effectName) => [
      createEffect("6", effectName, `${effectName}-plain`),
      withMode(effectName, false, "reactive"),
    ]);
    assert.equal(
      resolveAnimatedEffects(effects, clipContext, hitFrame),
      effects,
    );
  });

  it("ignores audio hits in Clip mode", () => {
    const effects = audioEffects.map((effectName) =>
      withMode(effectName, true, "clip"),
    );
    assert.deepEqual(
      resolveAnimatedEffects(effects, clipContext, hitFrame),
      resolveAnimatedEffects(effects, clipContext, quietFrame),
    );
  });

  it("moves the selected knobs on an audio hit in Reactive mode", () => {
    for (const effectName of audioEffects) {
      const effect = withMode(effectName, true, "reactive");
      const [quiet] = resolveAnimatedEffects([effect], clipContext, quietFrame);
      const [hit] = resolveAnimatedEffects([effect], clipContext, hitFrame);
      assert.equal(quiet, effect, effectName);
      assert.notDeepEqual(hit.parameters, effect.parameters, effectName);
    }
  });
});
