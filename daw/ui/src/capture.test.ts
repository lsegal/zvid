import assert from "node:assert/strict";
import test from "node:test";
import { captureControls, HELPER_FOLLOWING, HELPER_MANUAL } from "./capture.ts";
import type { Status } from "./ipc/types.ts";

const ready: Status = {
  phase: "ready",
  cameraId: "cam",
  format: { width: 1920, height: 1080, fps: [30, 1] },
  capture: null,
  error: null,
  live: null,
};

const capturing: Status = {
  ...ready,
  phase: "capturing",
  capture: { elapsedMs: 5000, takes: 1, droppedFrames: 0 },
};

test("offers Record and Stop capturing without the Live companion", () => {
  assert.deepEqual(captureControls(ready), {
    button: "record",
    following: null,
    helper: HELPER_MANUAL,
  });
  assert.equal(
    captureControls({ ...ready, phase: "noCamera" }).button,
    "record",
  );
  assert.equal(captureControls(capturing).button, "stop");
});

test("follows Live's record buttons while the companion is connected", () => {
  assert.deepEqual(
    captureControls({ ...ready, live: { recordArmed: false } }),
    { button: null, following: { armed: false }, helper: HELPER_FOLLOWING },
  );
  assert.deepEqual(
    captureControls({ ...ready, live: { recordArmed: true } }).following,
    { armed: true },
  );
  assert.equal(
    captureControls({ ...ready, phase: "error", live: { recordArmed: false } })
      .button,
    null,
  );
});

test("keeps Stop capturing for a running capture while following Live", () => {
  assert.deepEqual(
    captureControls({ ...capturing, live: { recordArmed: true } }),
    { button: "stop", following: { armed: true }, helper: HELPER_FOLLOWING },
  );
});
