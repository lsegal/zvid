import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SharedMediaStreams } from "./shared-media-streams.ts";

type Kind = "audio" | "video";

class FakeTrack {
  readonly kind: Kind;
  readonly deviceId: string;
  readyState: "live" | "ended" = "live";
  readonly source: FakeTrack;
  constructor(kind: Kind, deviceId: string, source?: FakeTrack) {
    this.kind = kind;
    this.deviceId = deviceId;
    this.source = source ?? this;
  }
  clone() {
    return new FakeTrack(this.kind, this.deviceId, this);
  }
  stop() {
    this.readyState = "ended";
  }
  getSettings() {
    return { deviceId: this.deviceId };
  }
}

function fakeStream(tracks: FakeTrack[]) {
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
  } as unknown as MediaStream;
}

function tracksOf(stream: MediaStream) {
  return stream.getTracks() as unknown as FakeTrack[];
}

// Which device a constraint opens: its exact ID, or the default's.
function requested(kind: Kind, constraint: unknown) {
  const exact = (constraint as { deviceId?: { exact?: string } }).deviceId
    ?.exact;
  return exact ?? `${kind}-default`;
}

function setup(options: { fail?: boolean } = {}) {
  const requests: MediaStreamConstraints[] = [];
  const opened: FakeTrack[] = [];
  const shared = new SharedMediaStreams(() => ({
    getUserMedia: async (constraints) => {
      requests.push(constraints);
      if (options.fail) throw new Error("denied");
      const tracks = (["video", "audio"] as const).flatMap((kind) =>
        constraints[kind]
          ? [new FakeTrack(kind, requested(kind, constraints[kind]))]
          : [],
      );
      opened.push(...tracks);
      return fakeStream(tracks);
    },
    createStream: (tracks) => fakeStream(tracks as unknown as FakeTrack[]),
  }));
  return { shared, requests, opened };
}

describe("shared media streams", () => {
  it("opens each device once and hands out clones of it", async () => {
    const { shared, requests, opened } = setup();
    const preview = await shared.acquire({
      audio: { deviceId: { exact: "mic" } },
    });
    const recording = await shared.acquire({
      video: { deviceId: { exact: "cam" } },
      audio: { deviceId: { exact: "mic" } },
    });
    // The recording only opened the camera, which nothing had yet.
    assert.deepEqual(requests, [
      { audio: { deviceId: { exact: "mic" } } },
      { video: { deviceId: { exact: "cam" } } },
    ]);
    assert.equal(shared.openDeviceCount, 2);
    const [previewMic] = tracksOf(preview);
    const recordingMic = tracksOf(recording).find(
      (track) => track.kind === "audio",
    );
    assert.ok(previewMic && recordingMic);
    assert.notEqual(previewMic, recordingMic);
    assert.equal(previewMic.source, recordingMic.source);
    assert.ok(opened.every((track) => !tracksOf(preview).includes(track)));
  });

  it("opens both devices of a new request in one call", async () => {
    const { shared, requests } = setup();
    await shared.acquire({
      video: { deviceId: { exact: "cam" } },
      audio: { deviceId: { exact: "mic" } },
    });
    assert.equal(requests.length, 1);
  });

  it("releases a device once its last clone is released", async () => {
    const { shared, opened } = setup();
    const first = await shared.acquire({
      audio: { deviceId: { exact: "mic" } },
    });
    const second = await shared.acquire({
      audio: { deviceId: { exact: "mic" } },
    });
    const [device] = opened;
    shared.release(first);
    assert.equal(device?.readyState, "live");
    assert.ok(tracksOf(first).every((track) => track.readyState === "ended"));
    shared.release(second);
    assert.equal(device?.readyState, "ended");
    assert.equal(shared.openDeviceCount, 0);
    // Releasing again changes nothing.
    shared.release(second);
    assert.equal(shared.openDeviceCount, 0);
  });

  it("shares requests that are still opening", async () => {
    const { shared, requests } = setup();
    const constraints = { video: { deviceId: { exact: "cam" } } };
    const [first, second] = await Promise.all([
      shared.acquire(constraints),
      shared.acquire(constraints),
    ]);
    assert.equal(requests.length, 1);
    assert.equal(tracksOf(first)[0]?.source, tracksOf(second)[0]?.source);
  });

  it("finds the browser's default by the device it opened", async () => {
    const { shared, requests } = setup();
    await shared.acquire({ audio: true });
    await shared.acquire({ audio: { deviceId: { exact: "audio-default" } } });
    assert.equal(requests.length, 1);
  });

  it("opens a device again once it went away", async () => {
    const { shared, requests, opened } = setup();
    const constraints = { video: { deviceId: { exact: "cam" } } };
    await shared.acquire(constraints);
    opened[0]?.stop();
    const again = await shared.acquire(constraints);
    assert.equal(requests.length, 2);
    assert.equal(tracksOf(again)[0]?.readyState, "live");
  });

  it("passes on a device that can't be opened", async () => {
    const { shared } = setup({ fail: true });
    await assert.rejects(shared.acquire({ audio: true }), /denied/);
    assert.equal(shared.openDeviceCount, 0);
  });
});
