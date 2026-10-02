import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
});
