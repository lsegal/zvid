import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrackInputOptions,
  describeDefaultInput,
  foldOnArmChange,
  initialRecordDeviceFold,
  parseTrackInputValue,
  TRACK_INPUT_DEFAULT,
  TRACK_INPUT_NONE,
  toggleRecordDeviceFold,
  trackInputValue,
} from "./track-record-device.ts";

describe("Record device folding", () => {
  it("is collapsed by default and expanded for an armed track", () => {
    assert.equal(initialRecordDeviceFold(false).expanded, false);
    assert.equal(initialRecordDeviceFold(true).expanded, true);
  });

  it("expands when the track is armed and folds again when disarmed", () => {
    const armed = foldOnArmChange(initialRecordDeviceFold(false), true);
    assert.equal(armed.expanded, true);
    assert.equal(foldOnArmChange(armed, false).expanded, false);
  });

  it("stays expanded on disarm when the user expanded it by hand", () => {
    const opened = toggleRecordDeviceFold(initialRecordDeviceFold(false));
    assert.equal(opened.expanded, true);
    const disarmed = foldOnArmChange(foldOnArmChange(opened, true), false);
    assert.equal(disarmed.expanded, true);
    // Folding it by hand forgets that.
    const folded = toggleRecordDeviceFold(disarmed);
    assert.equal(folded.expanded, false);
    assert.equal(
      foldOnArmChange(foldOnArmChange(folded, true), false).expanded,
      false,
    );
  });
});

describe("track input dropdown", () => {
  const devices = [
    { deviceId: "cam-a", label: "FaceTime Camera" },
    { deviceId: "cam-b", label: "OBS Virtual Camera" },
  ];

  it("offers Default, None and every device", () => {
    assert.deepEqual(buildTrackInputOptions(devices, "FaceTime Camera"), [
      { value: TRACK_INPUT_DEFAULT, label: "Default (FaceTime Camera)" },
      { value: TRACK_INPUT_NONE, label: "None" },
      { value: "device:cam-a", label: "FaceTime Camera" },
      { value: "device:cam-b", label: "OBS Virtual Camera" },
    ]);
  });

  it("round-trips overrides through dropdown values", () => {
    for (const override of [undefined, null, "cam-a", "default", "none"]) {
      assert.equal(parseTrackInputValue(trackInputValue(override)), override);
    }
  });

  it("names the default input", () => {
    assert.equal(describeDefaultInput(null, devices, "X"), "None");
    assert.equal(
      describeDefaultInput("cam-b", devices, "X"),
      "OBS Virtual Camera",
    );
    assert.equal(
      describeDefaultInput(undefined, devices, "FaceTime Camera"),
      "FaceTime Camera",
    );
    assert.equal(
      describeDefaultInput(undefined, [], undefined),
      "System default",
    );
  });
});
