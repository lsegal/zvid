import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listRecordDevices, type MediaDevicesLike } from "./record-devices.ts";
import {
  BROWSER_DEFAULT_INPUT,
  getInputConstraint,
  RECORD_INPUT_STORAGE_KEYS,
  RECORD_TRACK_INPUTS_STORAGE_KEY,
  type RecordInputStorage,
  readDefaultRecordInputs,
  readTrackRecordInputs,
  resolveDefaultRecordInputs,
  resolveTrackInputs,
  setDefaultRecordInput,
  setTrackRecordInput,
} from "./record-inputs.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  } satisfies RecordInputStorage & { values: Map<string, string> };
}

function mockDevices(
  devices: Array<{ kind: MediaDeviceKind; deviceId: string; label?: string }>,
): MediaDevicesLike {
  return {
    enumerateDevices: async () =>
      devices.map(
        (device) =>
          ({
            groupId: "",
            label: "",
            toJSON: () => ({}),
            ...device,
          }) as MediaDeviceInfo,
      ),
    getUserMedia: async () => {
      throw new Error("not used");
    },
  };
}

const ATTACHED = mockDevices([
  { kind: "videoinput", deviceId: "cam-built-in", label: "FaceTime HD" },
  { kind: "videoinput", deviceId: "cam-virtual", label: "OBS Virtual Camera" },
  { kind: "audioinput", deviceId: "default", label: "Default - USB Mic" },
  { kind: "audioinput", deviceId: "mic-usb", label: "USB Mic" },
  { kind: "audiooutput", deviceId: "speakers", label: "Speakers" },
]);

describe("record devices", () => {
  it("lists camera and mic inputs, not outputs", async () => {
    const devices = await listRecordDevices(ATTACHED);
    assert.deepEqual(
      devices.map((device) => [device.kind, device.deviceId, device.label]),
      [
        ["video", "cam-built-in", "FaceTime HD"],
        ["video", "cam-virtual", "OBS Virtual Camera"],
        ["audio", "default", "Default - USB Mic"],
        ["audio", "mic-usb", "USB Mic"],
      ],
    );
  });

  it("numbers devices whose labels are hidden before permission", async () => {
    const devices = await listRecordDevices(
      mockDevices([
        { kind: "videoinput", deviceId: "" },
        { kind: "audioinput", deviceId: "" },
        { kind: "audioinput", deviceId: "" },
      ]),
    );
    assert.deepEqual(
      devices.map((device) => device.label),
      ["Camera 1", "Microphone 1", "Microphone 2"],
    );
  });
});

describe("default record inputs", () => {
  it("saves device IDs and None per kind", () => {
    const storage = memoryStorage();
    setDefaultRecordInput("video", "cam-virtual", storage);
    setDefaultRecordInput("audio", null, storage);
    assert.equal(
      storage.values.get(RECORD_INPUT_STORAGE_KEYS.video),
      '"cam-virtual"',
    );
    assert.equal(storage.values.get(RECORD_INPUT_STORAGE_KEYS.audio), "null");
    assert.deepEqual(readDefaultRecordInputs(storage), {
      video: "cam-virtual",
      audio: null,
    });

    setDefaultRecordInput("video", undefined, storage);
    assert.equal(storage.values.has(RECORD_INPUT_STORAGE_KEYS.video), false);
    assert.deepEqual(readDefaultRecordInputs(storage), { audio: null });
  });

  it("reads corrupt values as unset", () => {
    const storage = memoryStorage({
      [RECORD_INPUT_STORAGE_KEYS.video]: "{not json",
      [RECORD_INPUT_STORAGE_KEYS.audio]: "42",
    });
    assert.deepEqual(readDefaultRecordInputs(storage), {});
  });

  it("resolves a saved device that is attached", async () => {
    const devices = await listRecordDevices(ATTACHED);
    const storage = memoryStorage();
    setDefaultRecordInput("video", "cam-virtual", storage);
    setDefaultRecordInput("audio", "mic-usb", storage);
    assert.deepEqual(resolveDefaultRecordInputs(devices, storage), {
      video: "cam-virtual",
      audio: "mic-usb",
    });
  });

  it("resolves None to no input", async () => {
    const devices = await listRecordDevices(ATTACHED);
    const storage = memoryStorage();
    setDefaultRecordInput("video", null, storage);
    setDefaultRecordInput("audio", null, storage);
    assert.deepEqual(resolveDefaultRecordInputs(devices, storage), {
      video: null,
      audio: null,
    });
    assert.equal(getInputConstraint(null), false);
  });

  it("falls back to the browser default when unset or the device is gone", async () => {
    const devices = await listRecordDevices(ATTACHED);
    const storage = memoryStorage();
    setDefaultRecordInput("video", "cam-unplugged", storage);
    assert.deepEqual(resolveDefaultRecordInputs(devices, storage), {
      video: BROWSER_DEFAULT_INPUT,
      audio: BROWSER_DEFAULT_INPUT,
    });
    assert.equal(getInputConstraint(BROWSER_DEFAULT_INPUT), true);
    assert.deepEqual(getInputConstraint("mic-usb"), {
      deviceId: { exact: "mic-usb" },
    });
  });

  it("resolves to None when no device of the kind is attached", async () => {
    const devices = await listRecordDevices(
      mockDevices([{ kind: "audioinput", deviceId: "mic-usb" }]),
    );
    const storage = memoryStorage();
    setDefaultRecordInput("video", "cam-built-in", storage);
    assert.deepEqual(resolveDefaultRecordInputs(devices, storage), {
      video: null,
      audio: BROWSER_DEFAULT_INPUT,
    });
  });

  it("trusts a saved device before permission reveals the IDs", async () => {
    const devices = await listRecordDevices(
      mockDevices([
        { kind: "videoinput", deviceId: "" },
        { kind: "audioinput", deviceId: "" },
      ]),
    );
    const storage = memoryStorage();
    setDefaultRecordInput("video", "cam-virtual", storage);
    assert.deepEqual(resolveDefaultRecordInputs(devices, storage), {
      video: "cam-virtual",
      audio: BROWSER_DEFAULT_INPUT,
    });
  });
});

describe("track record inputs", () => {
  it("prefers the track's override, then the default", async () => {
    const devices = await listRecordDevices(ATTACHED);
    const storage = memoryStorage();
    setDefaultRecordInput("video", "cam-built-in", storage);
    setDefaultRecordInput("audio", "mic-usb", storage);
    setTrackRecordInput("track-1", "video", "cam-virtual", storage);
    setTrackRecordInput("track-1", "audio", null, storage);

    assert.deepEqual(resolveTrackInputs("track-1", devices, storage), {
      video: "cam-virtual",
      audio: null,
    });
    assert.deepEqual(resolveTrackInputs("track-2", devices, storage), {
      video: "cam-built-in",
      audio: "mic-usb",
    });
  });

  it("falls back to the default when the override's device is gone", async () => {
    const devices = await listRecordDevices(ATTACHED);
    const storage = memoryStorage();
    setDefaultRecordInput("video", "cam-built-in", storage);
    setTrackRecordInput("track-1", "video", "cam-unplugged", storage);
    assert.deepEqual(resolveTrackInputs("track-1", devices, storage), {
      video: "cam-built-in",
      audio: BROWSER_DEFAULT_INPUT,
    });
  });

  it("clears an override and drops tracks with none left", () => {
    const storage = memoryStorage();
    setTrackRecordInput("track-1", "video", "cam-virtual", storage);
    setTrackRecordInput("track-1", "audio", null, storage);
    setTrackRecordInput("track-1", "video", undefined, storage);
    assert.deepEqual(readTrackRecordInputs("track-1", storage), {
      audio: null,
    });
    setTrackRecordInput("track-1", "audio", undefined, storage);
    assert.deepEqual(readTrackRecordInputs("track-1", storage), {});
    assert.equal(storage.values.has(RECORD_TRACK_INPUTS_STORAGE_KEY), false);
  });
});
