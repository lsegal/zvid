import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDefaultInputOptions,
  defaultInputValue,
  describeDeniedInput,
  parseDefaultInputValue,
} from "./default-record-inputs.ts";

const DEVICES = [
  { deviceId: "cam-built-in", label: "FaceTime HD" },
  { deviceId: "cam-virtual", label: "OBS Virtual Camera" },
];

describe("default record input dropdowns", () => {
  it("offers the system default, None and every device", () => {
    assert.deepEqual(buildDefaultInputOptions(DEVICES, "FaceTime HD"), [
      { value: "default", label: "System default (FaceTime HD)" },
      { value: "none", label: "None" },
      { value: "device:cam-built-in", label: "FaceTime HD" },
      { value: "device:cam-virtual", label: "OBS Virtual Camera" },
    ]);
    assert.equal(
      buildDefaultInputOptions([], undefined)[0].label,
      "System default",
    );
  });

  it("round-trips None, a device and the system default", () => {
    for (const input of [null, "cam-virtual", undefined]) {
      assert.equal(parseDefaultInputValue(defaultInputValue(input)), input);
    }
  });

  it("explains a denied device", () => {
    assert.match(describeDeniedInput("video"), /^Camera access was denied/);
    assert.match(describeDeniedInput("audio"), /^Microphone access was denied/);
  });
});
