import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  browserDefaultDeviceId,
  browserDefaultLabel,
  getRecordInputsVersion,
  listInputDevices,
  RECORD_INPUT_STORAGE_KEYS,
  RECORD_TRACK_INPUTS_STORAGE_KEY,
  readDefaultInput,
  readTrackInputOverride,
  resolveTrackInputs,
  resolveTrackOverride,
  withBrowserDefaults,
  writeDefaultInput,
  writeTrackInputOverride,
} from "./record-inputs.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const AVAILABLE = { video: ["cam-a", "cam-b"], audio: ["mic-a"] };

describe("default record inputs", () => {
  it("saves a device, None, or nothing under the per-machine keys", () => {
    const storage = memoryStorage();
    assert.equal(readDefaultInput("video", storage), undefined);
    writeDefaultInput("video", "cam-a", storage);
    writeDefaultInput("audio", null, storage);
    assert.equal(
      storage.values.get(RECORD_INPUT_STORAGE_KEYS.video),
      JSON.stringify("cam-a"),
    );
    assert.equal(storage.values.get("zvid-record-audio-input"), "null");
    assert.equal(readDefaultInput("video", storage), "cam-a");
    assert.equal(readDefaultInput("audio", storage), null);
    writeDefaultInput("video", undefined, storage);
    assert.equal(readDefaultInput("video", storage), undefined);
  });

  it("ignores unreadable saved values", () => {
    const storage = memoryStorage();
    storage.setItem(RECORD_INPUT_STORAGE_KEYS.video, "{not json");
    storage.setItem(RECORD_INPUT_STORAGE_KEYS.audio, "42");
    assert.equal(readDefaultInput("video", storage), undefined);
    assert.equal(readDefaultInput("audio", storage), undefined);
  });

  it("tells subscribers that a choice changed", () => {
    const before = getRecordInputsVersion();
    writeDefaultInput("video", "cam-a", memoryStorage());
    assert.notEqual(getRecordInputsVersion(), before);
  });
});

describe("track input overrides", () => {
  it("starts out using the default inputs", () => {
    const storage = memoryStorage();
    writeDefaultInput("video", "cam-a", storage);
    writeDefaultInput("audio", "mic-a", storage);
    assert.deepEqual(readTrackInputOverride("track-1", storage), {});
    assert.deepEqual(resolveTrackInputs("track-1", AVAILABLE, storage), {
      video: "cam-a",
      audio: "mic-a",
    });
  });

  it("uses the track's override in place of the default", () => {
    const storage = memoryStorage();
    writeDefaultInput("video", "cam-a", storage);
    writeTrackInputOverride("track-1", "video", "cam-b", storage);
    writeTrackInputOverride("track-1", "audio", null, storage);
    assert.deepEqual(resolveTrackInputs("track-1", AVAILABLE, storage), {
      video: "cam-b",
      audio: null,
    });
    // Other tracks keep the defaults.
    assert.deepEqual(resolveTrackInputs("track-2", AVAILABLE, storage), {
      video: "cam-a",
      audio: undefined,
    });
  });

  it("clears an override so the track follows the default again", () => {
    const storage = memoryStorage();
    writeDefaultInput("video", "cam-a", storage);
    writeTrackInputOverride("track-1", "video", "cam-b", storage);
    writeTrackInputOverride("track-1", "video", undefined, storage);
    assert.deepEqual(readTrackInputOverride("track-1", storage), {});
    assert.equal(storage.values.get(RECORD_TRACK_INPUTS_STORAGE_KEY), "{}");
    assert.equal(
      resolveTrackInputs("track-1", AVAILABLE, storage).video,
      "cam-a",
    );
    writeDefaultInput("video", "cam-b", storage);
    assert.equal(
      resolveTrackInputs("track-1", AVAILABLE, storage).video,
      "cam-b",
    );
  });

  it("falls back to the default, then the browser's, when a device is gone", () => {
    const storage = memoryStorage();
    writeDefaultInput("video", "cam-a", storage);
    writeDefaultInput("audio", "mic-gone", storage);
    writeTrackInputOverride("track-1", "video", "cam-gone", storage);
    writeTrackInputOverride("track-1", "audio", "mic-gone-too", storage);
    assert.equal(
      resolveTrackOverride("track-1", "video", AVAILABLE, storage),
      undefined,
    );
    assert.deepEqual(resolveTrackInputs("track-1", AVAILABLE, storage), {
      video: "cam-a",
      audio: undefined,
    });
    // Before the device list arrives, saved devices are trusted.
    assert.deepEqual(resolveTrackInputs("track-1", undefined, storage), {
      video: "cam-gone",
      audio: "mic-gone-too",
    });
  });
});

describe("listInputDevices", () => {
  const infos = [
    { deviceId: "default", kind: "audioinput", label: "Default - USB Mic" },
    {
      deviceId: "communications",
      kind: "audioinput",
      label: "Communications - USB Mic",
    },
    { deviceId: "mic-a", kind: "audioinput", label: "USB Mic" },
    { deviceId: "cam-a", kind: "videoinput", label: "" },
    { deviceId: "cam-b", kind: "videoinput", label: "Continuity Camera" },
    { deviceId: "out-a", kind: "audiooutput", label: "Speakers" },
  ] as const;

  it("lists each kind's devices without the browser's aliases", () => {
    assert.deepEqual(listInputDevices(infos, "audio"), [
      { deviceId: "mic-a", label: "USB Mic" },
    ]);
    assert.deepEqual(listInputDevices(infos, "video"), [
      { deviceId: "cam-a", label: "Camera 1" },
      { deviceId: "cam-b", label: "Continuity Camera" },
    ]);
  });

  it("names the browser's default device", () => {
    assert.equal(browserDefaultLabel(infos, "audio"), "USB Mic");
    assert.equal(browserDefaultLabel(infos, "video"), "Camera 1");
    assert.equal(browserDefaultLabel([], "video"), undefined);
  });
});

describe("browser default device", () => {
  // An audio interface lists one input per channel pair, all in its group.
  const interfaceInfos = [
    {
      deviceId: "default",
      groupId: "usb",
      kind: "audioinput",
      label: "Default - Line 3/4 (USB Interface)",
    },
    {
      deviceId: "communications",
      groupId: "built-in",
      kind: "audioinput",
      label: "Communications - Built-in Mic",
    },
    {
      deviceId: "built-in",
      groupId: "built-in",
      kind: "audioinput",
      label: "Built-in Mic",
    },
    {
      deviceId: "line-12",
      groupId: "usb",
      kind: "audioinput",
      label: "Line 1/2 (USB Interface)",
    },
    {
      deviceId: "line-34",
      groupId: "usb",
      kind: "audioinput",
      label: "Line 3/4 (USB Interface)",
    },
    { deviceId: "cam-a", groupId: "cam", kind: "videoinput", label: "Cam" },
  ] as const;

  it("resolves Chromium's default alias to the device it names", () => {
    assert.equal(browserDefaultDeviceId(interfaceInfos, "audio"), "line-34");
  });

  it("falls back to the alias's group when no device has its name", () => {
    const infos = [
      {
        deviceId: "default",
        groupId: "usb",
        kind: "audioinput",
        label: "Default - USB Interface",
      },
      { deviceId: "built-in", groupId: "built-in", kind: "audioinput" },
      { deviceId: "line-12", groupId: "usb", kind: "audioinput" },
    ] as const;
    assert.equal(browserDefaultDeviceId(infos, "audio"), "line-12");
  });

  it("uses the first device listed without an alias", () => {
    assert.equal(browserDefaultDeviceId(interfaceInfos, "video"), "cam-a");
    assert.equal(
      browserDefaultDeviceId(
        [
          { deviceId: "mic-b", kind: "audioinput", label: "Mic B" },
          { deviceId: "mic-a", kind: "audioinput", label: "Mic A" },
        ],
        "audio",
      ),
      "mic-b",
    );
  });

  it("follows the system default when it changes", () => {
    const changed = interfaceInfos.map((info) =>
      info.deviceId === "default"
        ? { ...info, groupId: "built-in", label: "Default - Built-in Mic" }
        : info,
    );
    assert.equal(browserDefaultDeviceId(changed, "audio"), "built-in");
  });

  it("is undefined until the browser lists device IDs", () => {
    assert.equal(browserDefaultDeviceId([], "audio"), undefined);
    assert.equal(
      browserDefaultDeviceId(
        [{ deviceId: "", kind: "audioinput", label: "" }],
        "audio",
      ),
      undefined,
    );
  });

  it("resolves only inputs left on the browser's default", () => {
    assert.deepEqual(
      withBrowserDefaults(
        { video: undefined, audio: undefined },
        interfaceInfos,
      ),
      { video: "cam-a", audio: "line-34" },
    );
    assert.deepEqual(
      withBrowserDefaults({ video: null, audio: "line-12" }, interfaceInfos),
      { video: null, audio: "line-12" },
    );
    assert.deepEqual(
      withBrowserDefaults({ video: undefined, audio: undefined }, []),
      { video: undefined, audio: undefined },
    );
  });
});
