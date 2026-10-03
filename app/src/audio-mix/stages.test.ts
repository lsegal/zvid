import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultModulation } from "../fx-modulation-defaults.ts";
import { TEST_PROCESSORS, testStage } from "./chain-test-utils.ts";
import { audioStageOf, hasProcessingStages } from "./stages.ts";

describe("audioStageOf", () => {
  it("reads a Gain's level as a number and its Mute as a switch", () => {
    const stage = audioStageOf(
      {
        id: "gain-1",
        trackId: "clip-a",
        effectName: "Gain",
        parameters: [
          { key: "Gain", value: "-6", numericValue: -6 },
          { key: "Mute", value: "1", numericValue: 1 },
        ],
      },
      "fallback",
    );
    assert.deepEqual(stage, {
      id: "gain-1",
      effectName: "Gain",
      enabled: true,
      numbers: { Gain: -6 },
      switches: { Mute: "1" },
    });
  });

  it("fills unset parameters with their defaults, and names an effect without an id", () => {
    const stage = audioStageOf(
      { trackId: "clip-a", effectName: "Gain", parameters: [] },
      "clip-a:0",
    );
    assert.equal(stage.id, "clip-a:0");
    assert.deepEqual(stage.numbers, { Gain: 0 });
    assert.deepEqual(stage.switches, { Mute: "0" });
  });

  it("is disabled when bypassed itself or by its track", () => {
    const gain = { trackId: "t", effectName: "Gain", parameters: [] };
    assert.equal(audioStageOf({ ...gain, enabled: false }, "a").enabled, false);
    assert.equal(audioStageOf(gain, "a", false).enabled, false);
  });
});

describe("audioStageOf modulation", () => {
  const highCut = (modulation = createDefaultModulation("High Cut")) => ({
    id: "cut",
    trackId: "t",
    effectName: "High Cut",
    parameters: [],
    modulation,
  });

  it("gives the stage its Transient settings and the knobs' ranges", () => {
    assert.deepEqual(audioStageOf(highCut(), "a").modulation, {
      mode: "transient",
      motion: "Bounce",
      reactivity: 0.5,
      lengthFrames: 12,
      parameters: [{ key: "Frequency", min: 20, max: 20000, taper: "log" }],
    });
  });

  it("gives the stage its LFO settings", () => {
    const modulation = createDefaultModulation("High Cut");
    assert.ok(modulation);
    const stage = audioStageOf(
      highCut({
        ...modulation,
        mode: "lfo",
        lfo: { ...modulation.lfo, shape: "Square", phase: 90 },
      }),
      "a",
    );
    assert.equal(stage.modulation?.mode, "lfo");
    assert.equal(
      stage.modulation?.mode === "lfo" && stage.modulation.shape,
      "Square",
    );
  });

  it("leaves modulation out while it is off or would move nothing", () => {
    const modulation = createDefaultModulation("High Cut");
    assert.ok(modulation);
    const off = { ...modulation, enabled: false };
    const still = {
      ...modulation,
      transient: { ...modulation.transient, motion: "None" as const },
    };
    const none = {
      ...modulation,
      transient: { ...modulation.transient, parameters: [] },
    };
    const flat = {
      ...modulation,
      mode: "lfo" as const,
      lfo: { ...modulation.lfo, depth: 0 },
    };
    for (const settings of [off, still, none, flat]) {
      assert.equal("modulation" in audioStageOf(highCut(settings), "a"), false);
    }
    const { modulation: _, ...plain } = highCut();
    assert.equal("modulation" in audioStageOf(plain, "a"), false);
  });

  it("never modulates a toggle", () => {
    const modulation = createDefaultModulation("Gain");
    assert.ok(modulation);
    const stage = audioStageOf(
      {
        trackId: "t",
        effectName: "Gain",
        parameters: [],
        modulation: {
          ...modulation,
          transient: { ...modulation.transient, parameters: ["Gain", "Mute"] },
        },
      },
      "a",
    );
    assert.deepEqual(
      stage.modulation?.parameters.map((parameter) => parameter.key),
      ["Gain"],
    );
  });
});

describe("hasProcessingStages", () => {
  it("counts only enabled stages with a processor other than Gain", () => {
    const gain = {
      id: "g",
      effectName: "Gain",
      enabled: true,
      numbers: {},
      switches: {},
    };
    assert.equal(hasProcessingStages(TEST_PROCESSORS, [gain]), false);
    assert.equal(
      hasProcessingStages(TEST_PROCESSORS, [testStage("Unregistered")]),
      false,
    );
    assert.equal(
      hasProcessingStages(TEST_PROCESSORS, [
        testStage("Test Echo", {}, { enabled: false }),
      ]),
      false,
    );
    assert.equal(
      hasProcessingStages(TEST_PROCESSORS, [gain, testStage("Test Echo")]),
      true,
    );
  });

  it("counts a modulated Gain, which a native gain can't play", () => {
    const gain = audioStageOf(
      {
        trackId: "t",
        effectName: "Gain",
        parameters: [],
        modulation: createDefaultModulation("Gain"),
      },
      "g",
    );
    assert.equal(hasProcessingStages(TEST_PROCESSORS, [gain]), true);
  });
});
