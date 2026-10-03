import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getRecordMediaConstraints,
  RECORD_AUDIO_INPUT_STORAGE_KEY,
  RECORD_VIDEO_INPUT_STORAGE_KEY,
  readTrackRecordInputs,
  resolveTrackInputs,
  writeDefaultRecordInput,
  writeTrackRecordInputs,
} from "./record-inputs.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
  };
}

const devices = [
  { kind: "videoinput" as const, deviceId: "cam-1" },
  { kind: "videoinput" as const, deviceId: "cam-2" },
  { kind: "audioinput" as const, deviceId: "mic-1" },
];

describe("record inputs", () => {
  it("uses the browser's default devices when nothing is saved", () => {
    assert.deepEqual(resolveTrackInputs("track", devices, memoryStorage()), {
      video: undefined,
      audio: undefined,
    });
  });

  it("uses the defaults, then each track's overrides", () => {
    const storage = memoryStorage();
    writeDefaultRecordInput("video", "cam-1", storage);
    writeDefaultRecordInput("audio", null, storage);
    assert.equal(storage.values.get(RECORD_VIDEO_INPUT_STORAGE_KEY), '"cam-1"');
    assert.equal(storage.values.get(RECORD_AUDIO_INPUT_STORAGE_KEY), "null");
    assert.deepEqual(resolveTrackInputs("a", devices, storage), {
      video: "cam-1",
      audio: null,
    });

    writeTrackRecordInputs("b", { video: "cam-2", audio: "mic-1" }, storage);
    assert.deepEqual(resolveTrackInputs("b", devices, storage), {
      video: "cam-2",
      audio: "mic-1",
    });
    // Only the kinds a track overrides differ from the defaults.
    writeTrackRecordInputs("c", { video: null }, storage);
    assert.deepEqual(resolveTrackInputs("c", devices, storage), {
      video: null,
      audio: null,
    });
  });

  it("falls back when a saved device is no longer attached", () => {
    const storage = memoryStorage();
    writeDefaultRecordInput("video", "cam-1", storage);
    writeTrackRecordInputs("a", { video: "unplugged" }, storage);
    assert.equal(resolveTrackInputs("a", devices, storage).video, "cam-1");
    // Without the default device either, the browser picks one.
    assert.equal(
      resolveTrackInputs("a", devices.slice(1), storage).video,
      undefined,
    );
  });

  it("removes a track's entry when its overrides are cleared", () => {
    const storage = memoryStorage();
    writeTrackRecordInputs("a", { audio: "mic-1" }, storage);
    writeTrackRecordInputs("a", {}, storage);
    assert.deepEqual(readTrackRecordInputs(storage), {});
  });

  it("ignores unreadable storage", () => {
    const storage = memoryStorage();
    storage.setItem(RECORD_VIDEO_INPUT_STORAGE_KEY, "{");
    storage.setItem("zvid-record-track-inputs", "[1]");
    assert.deepEqual(resolveTrackInputs("a", devices, storage), {
      video: undefined,
      audio: undefined,
    });
  });

  it("builds getUserMedia constraints, or none when both are None", () => {
    assert.deepEqual(
      getRecordMediaConstraints({ video: "cam-1", audio: undefined }),
      { video: { deviceId: { exact: "cam-1" } }, audio: true },
    );
    assert.deepEqual(
      getRecordMediaConstraints({ video: null, audio: "mic-1" }),
      { video: false, audio: { deviceId: { exact: "mic-1" } } },
    );
    assert.equal(getRecordMediaConstraints({ video: null, audio: null }), null);
  });
});
