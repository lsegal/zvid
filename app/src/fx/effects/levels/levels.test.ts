import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnimatableParameters } from "../../../fx-animation-defaults.ts";
import { FX_EFFECT_DEFINITIONS } from "../../../fx-registry.ts";
import {
  createEffect,
  mapEffects,
  mapSessionEffectsToDevices,
  setEffectParameter,
} from "../../../fx-stack.ts";
import { projectToSession } from "../../../session-save.ts";
import { ALL_SCOPES } from "../../types.ts";
import { formatCurves, parseCurves } from "./curve.ts";
import {
  CURVE_KEY,
  LEVELS_EFFECT_NAME,
  puckChannels,
  puckPosition,
  WHEELS,
} from "./levels.ts";

describe("Levels color wheels", () => {
  it("moves the puck back to where the channels put it", () => {
    for (const [x, y] of [
      [0, 0],
      [0.5, 0],
      [0, -0.8],
      [-0.3, 0.4],
    ] as const) {
      const rgb = puckChannels([x, y], 0.1, 0.25);
      // The puck tints without changing the channels' mean.
      assert.ok(Math.abs((rgb[0] + rgb[1] + rgb[2]) / 3 - 0.1) < 1e-9);
      const [px, py] = puckPosition(rgb, 0.25);
      assert.ok(Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9);
    }
  });

  it("puts red at the top of the wheel and keeps the puck inside it", () => {
    const [red, green, blue] = puckChannels([0, -1], 0, 0.5);
    assert.ok(Math.abs(red - 0.5) < 1e-9);
    assert.ok(Math.abs(green + 0.25) < 1e-9);
    assert.ok(Math.abs(blue + 0.25) < 1e-9);
    const far = puckPosition(puckChannels([0, -3], 0, 0.5), 0.5);
    assert.ok(Math.abs(Math.hypot(...far) - 1) < 1e-9);
  });
});

describe("Levels effect", () => {
  it("is offered on every video stack, in the color menu", () => {
    const definition = FX_EFFECT_DEFINITIONS.find(
      (candidate) => candidate.effectName === LEVELS_EFFECT_NAME,
    );
    assert.ok(definition);
    assert.equal(definition.category, "color");
    assert.deepEqual(definition.scopes, ALL_SCOPES);
  });

  it("shows each wheel as one control holding its Y, R, G and B numbers, then the curve", () => {
    const effects = [createEffect("1", LEVELS_EFFECT_NAME, "levels")];
    const [device] = mapSessionEffectsToDevices(effects, "1");
    assert.deepEqual(
      device.parameters.map((parameter) => [
        parameter.label,
        parameter.kind,
        parameter.control,
      ]),
      [
        ["Lift", "number", "wheel"],
        ["Gamma", "number", "wheel"],
        ["Gain", "number", "wheel"],
        ["Offset", "number", "wheel"],
        ["Curve", "curve", undefined],
      ],
    );
    assert.equal(device.knobColumns, WHEELS.length + 1);
    const gain = device.parameters[2];
    assert.deepEqual(
      gain.channels?.map((channel) => [channel.key, channel.numericValue]),
      [
        ["GainY", 1],
        ["GainR", 1],
        ["GainG", 1],
        ["GainB", 1],
      ],
    );
    assert.equal(device.parameters[4].stringValue, "");
  });

  it("lets Animation move every wheel number but not the curve", () => {
    const keys = getAnimatableParameters(LEVELS_EFFECT_NAME).map(
      (parameter) => parameter.key,
    );
    assert.equal(keys.length, 16);
    assert.ok(keys.includes("LiftR") && keys.includes("GainY"));
    assert.ok(!keys.includes(CURVE_KEY));
  });

  it("saves its wheels and curve in the session and reads them back", () => {
    const curve = formatCurves({
      ...parseCurves(""),
      master: [
        [0, 0],
        [0.4, 0.6],
        [1, 1],
      ],
      blue: [
        [0, 0.1],
        [1, 0.9],
      ],
    });
    let effects = [createEffect("main-1", LEVELS_EFFECT_NAME, "levels")];
    effects = setEffectParameter(effects, "levels", "GainR", 1.25);
    effects = setEffectParameter(effects, "levels", "LiftY", 0.1);
    effects = setEffectParameter(effects, "levels", CURVE_KEY, curve);
    const session = projectToSession(
      {
        bpm: 120,
        fps: 30,
        canvasWidth: 1080,
        canvasHeight: 1920,
        zoom: 1,
        timelineMode: "musical",
        snapEnabled: true,
        lanes: [{ id: "main-1", name: "Layer 1", colorIndex: 0 }],
        sourceTracks: [],
        sourceSpans: [],
        clips: [],
        effects,
        mediaItems: [],
      },
      { playheadQ: 0 },
    );
    const saved = JSON.parse(JSON.stringify(session));
    assert.deepEqual(saved.effects[0].parameters.Curve, {
      stringValue: curve,
    });
    assert.deepEqual(saved.effects[0].parameters.GainR, { floatValue: 1.25 });
    const [restored] = mapEffects(saved.effects);
    const read = (key: string) =>
      restored.parameters.find((parameter) => parameter.key === key);
    assert.equal(read("GainR")?.numericValue, 1.25);
    assert.equal(read("LiftY")?.numericValue, 0.1);
    assert.equal(read("GainY")?.numericValue, 1);
    assert.equal(read(CURVE_KEY)?.value, curve);
    assert.deepEqual(parseCurves(read(CURVE_KEY)?.value), parseCurves(curve));
  });
});
