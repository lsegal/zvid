import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describePreviewError,
  type MediaDevicesLike,
  openPreviewStream,
  stopStream,
} from "./record-devices.ts";
import { BROWSER_DEFAULT_INPUT } from "./record-inputs.ts";

function fakeStream() {
  const stopped: string[] = [];
  const stream = {
    getTracks: () => [{ stop: () => stopped.push("track") }],
  } as unknown as MediaStream;
  return { stream, stopped };
}

function mockMediaDevices(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
): MediaDevicesLike {
  return { enumerateDevices: async () => [], getUserMedia };
}

function domError(name: string) {
  return Object.assign(new Error(name), { name });
}

describe("record preview streams", () => {
  it("asks for nothing for None", async () => {
    let asked = false;
    const devices = mockMediaDevices(async () => {
      asked = true;
      return fakeStream().stream;
    });
    assert.deepEqual(await openPreviewStream(devices, "video", null), {
      stream: null,
    });
    assert.equal(asked, false);
  });

  it("opens only the picked kind on the picked device", async () => {
    const requests: MediaStreamConstraints[] = [];
    const { stream } = fakeStream();
    const devices = mockMediaDevices(async (constraints) => {
      requests.push(constraints);
      return stream;
    });
    assert.deepEqual(await openPreviewStream(devices, "audio", "mic-usb"), {
      stream,
    });
    await openPreviewStream(devices, "video", BROWSER_DEFAULT_INPUT);
    assert.deepEqual(requests, [
      { video: false, audio: { deviceId: { exact: "mic-usb" } } },
      { video: true, audio: false },
    ]);
  });

  it("reports denied, missing and unavailable devices", async () => {
    const failWith = (name: string) =>
      mockMediaDevices(async () => {
        throw domError(name);
      });
    assert.deepEqual(
      await openPreviewStream(failWith("NotAllowedError"), "video", ""),
      { error: "denied" },
    );
    assert.deepEqual(
      await openPreviewStream(failWith("OverconstrainedError"), "audio", "x"),
      { error: "missing" },
    );
    assert.deepEqual(
      await openPreviewStream(failWith("NotReadableError"), "audio", ""),
      { error: "unavailable" },
    );
    assert.deepEqual(await openPreviewStream(null, "audio", ""), {
      error: "unavailable",
    });
    assert.match(describePreviewError("video", "denied"), /Camera access/);
  });

  it("stops every track of a stream", () => {
    const { stream, stopped } = fakeStream();
    stopStream(stream);
    stopStream(null);
    assert.deepEqual(stopped, ["track"]);
  });
});
