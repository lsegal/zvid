import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceSummary,
  fileManagerName,
  formatBarPosition,
  formatDuration,
  formatFps,
  formatTakeDate,
  formatTimer,
  statusLabel,
  transportLabel,
} from "./format.ts";

test("formats the capture timer", () => {
  assert.equal(formatTimer(0), "00:00:00");
  assert.equal(formatTimer(5_999), "00:00:05");
  assert.equal(formatTimer(3_723_000), "01:02:03");
  assert.equal(formatTimer(-10), "00:00:00");
});

test("formats take durations as mm:ss", () => {
  assert.equal(formatDuration(36.2), "00:36");
  assert.equal(formatDuration(72), "01:12");
  assert.equal(formatDuration(3723), "1:02:03");
});

test("formats transport positions like Live", () => {
  assert.equal(formatBarPosition(0, [4, 4]), "Bar 1.1.1");
  assert.equal(formatBarPosition(64, [4, 4]), "Bar 17.1.1");
  assert.equal(formatBarPosition(63.9999999, [4, 4]), "Bar 17.1.1");
  assert.equal(formatBarPosition(65.5, [4, 4]), "Bar 17.2.3");
  // 6/8: a bar is three quarter notes, a beat an eighth note.
  assert.equal(formatBarPosition(3, [6, 8]), "Bar 2.1.1");
  assert.equal(formatBarPosition(3.75, [6, 8]), "Bar 2.2.2");
  assert.equal(formatBarPosition(-1, [4, 4]), "Bar 1.1.1");
});

test("formats take dates", () => {
  assert.equal(
    formatTakeDate("2026-09-25T20:36:12Z", "en-US", "UTC"),
    "Sep 25 · 8:36 PM",
  );
  assert.equal(formatTakeDate("not a date", "en-US", "UTC"), "not a date");
});

test("summarizes the device", () => {
  const camera = {
    id: "1",
    name: "FaceTime HD Camera",
    transport: "builtIn" as const,
  };
  assert.equal(deviceSummary(undefined, null), "No camera");
  assert.equal(deviceSummary(camera, null), "FaceTime HD Camera");
  assert.equal(
    deviceSummary(camera, { width: 1920, height: 1080, fps: [30, 1] }),
    "FaceTime HD Camera · 1920×1080 · 30 fps",
  );
  assert.equal(formatFps([30000, 1001]), "29.97 fps");
});

test("labels transports, phases and file managers", () => {
  assert.equal(transportLabel("continuity"), "Continuity");
  assert.equal(transportLabel("usb"), "USB");
  assert.equal(statusLabel("ready"), "Ready to capture");
  assert.equal(statusLabel("noCamera"), "No camera");
  assert.equal(fileManagerName("macos"), "Finder");
  assert.equal(fileManagerName("windows"), "Explorer");
});
