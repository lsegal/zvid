import assert from "node:assert/strict";
import test from "node:test";
import type { Status, TakeInfo } from "./ipc/types.ts";
import {
  type AppState,
  captureElapsed,
  initialState,
  reducer,
  selectedCamera,
} from "./state.ts";

const take = (id: string): TakeInfo => ({
  id,
  filename: `${id}.mp4`,
  createdAt: "2026-09-25T20:36:12Z",
  durationSec: 36,
  fileOffsetSec: 1.5,
  transportStartBeats: 64,
  timeSignature: [4, 4],
  unanchored: false,
  missing: false,
});

const capturing: Status = {
  phase: "capturing",
  cameraId: "cam",
  format: { width: 1920, height: 1080, fps: [30, 1] },
  capture: { elapsedMs: 5000, takes: 1, droppedFrames: 0 },
  error: null,
  live: null,
};

test("loads the full state", () => {
  const state = reducer(initialState, {
    type: "loaded",
    status: capturing,
    cameras: [{ id: "cam", name: "FaceTime HD Camera", transport: "builtIn" }],
    takes: [take("a")],
    at: 100,
  });
  assert.equal(state.loaded, true);
  assert.equal(selectedCamera(state)?.name, "FaceTime HD Camera");
  assert.equal(state.takes.length, 1);
});

test("runs the capture timer from the last status", () => {
  const state = reducer(initialState, {
    type: "status",
    status: capturing,
    at: 1000,
  });
  assert.equal(captureElapsed(state, 1000), 5000);
  assert.equal(captureElapsed(state, 3500), 7500);
  assert.equal(captureElapsed(state, 500), 5000);
  assert.equal(captureElapsed(initialState, 3500), 0);
});

test("puts closed takes first without duplicates", () => {
  let state: AppState = { ...initialState, takes: [take("a"), take("b")] };
  state = reducer(state, { type: "takeClosed", take: take("c") });
  assert.deepEqual(
    state.takes.map((t) => t.id),
    ["c", "a", "b"],
  );
  state = reducer(state, { type: "takeClosed", take: take("b") });
  assert.deepEqual(
    state.takes.map((t) => t.id),
    ["b", "c", "a"],
  );
});

test("shows one toast, newest first", () => {
  let state = initialState;
  for (let id = 1; id <= 3; id++) {
    state = reducer(state, {
      type: "error",
      error: { code: "internal", message: `oops ${id}` },
      id,
    });
  }
  assert.deepEqual(state.toast, { id: 3, message: "oops 3" });
  // Dismissing a toast that was already replaced keeps the newer one.
  state = reducer(state, { type: "dismiss", id: 2 });
  assert.equal(state.toast?.id, 3);
  state = reducer(state, { type: "dismiss", id: 3 });
  assert.equal(state.toast, null);
});

test("tracks the command in flight", () => {
  const state = reducer(initialState, { type: "busy", busy: "arm" });
  assert.equal(state.busy, "arm");
  assert.equal(reducer(state, { type: "busy", busy: null }).busy, null);
});
