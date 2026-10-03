import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RecordInputs } from "./record-inputs.ts";
import {
  availableInputs,
  getRecordMediaConstraints,
  type MediaRecorderLike,
  pickRecorderMimeType,
  type RecordingDeps,
  RecordingSession,
  recordingExtension,
} from "./recording-session.ts";

class FakeTrack extends EventTarget {
  readonly kind: "audio" | "video";
  stopped = false;
  constructor(kind: "audio" | "video") {
    super();
    this.kind = kind;
  }
  stop() {
    this.stopped = true;
  }
  // The device goes away, as when a camera is unplugged.
  end() {
    this.dispatchEvent(new Event("ended"));
  }
}

function fakeStream(constraints: MediaStreamConstraints) {
  const tracks = [
    ...(constraints.video ? [new FakeTrack("video")] : []),
    ...(constraints.audio ? [new FakeTrack("audio")] : []),
  ];
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
  } as unknown as MediaStream & { tracks: FakeTrack[] };
}

class FakeRecorder implements MediaRecorderLike {
  state: "inactive" | "recording" | "paused" = "inactive";
  readonly mimeType: string;
  readonly stream: MediaStream;
  startedAt: number | undefined;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private readonly clock: { now: number };
  constructor(
    stream: MediaStream,
    mimeType: string | undefined,
    clock: { now: number },
  ) {
    this.stream = stream;
    this.mimeType = mimeType ?? "";
    this.clock = clock;
  }
  start() {
    this.state = "recording";
    this.startedAt = this.clock.now;
  }
  stop() {
    this.state = "inactive";
    // Like MediaRecorder: the last data, then stop, after the call returns.
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob([`take from ${this.startedAt}`], {
          type: this.mimeType,
        }),
      });
      this.onstop?.();
    });
  }
}

function setup(
  inputs: Record<string, RecordInputs>,
  options: { deny?: string[]; supported?: string[] } = {},
) {
  const clock = { now: 1000 };
  const recorders: FakeRecorder[] = [];
  const streams = new Map<string, MediaStream & { tracks: FakeTrack[] }>();
  const deps: RecordingDeps = {
    enumerateDevices: async () => [
      { kind: "videoinput", deviceId: "cam" },
      { kind: "audioinput", deviceId: "mic" },
    ],
    getUserMedia: async (constraints) => {
      const video = constraints.video as { deviceId?: { exact: string } };
      const audio = constraints.audio as { deviceId?: { exact: string } };
      const id = video?.deviceId?.exact ?? audio?.deviceId?.exact ?? "";
      if (options.deny?.includes(id)) {
        throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      }
      const stream = fakeStream(constraints);
      streams.set(id, stream);
      return stream;
    },
    isTypeSupported: (type) =>
      (options.supported ?? ["video/webm", "audio/webm"]).includes(type),
    createRecorder: (stream, { mimeType }) => {
      const recorder = new FakeRecorder(stream, mimeType, clock);
      recorders.push(recorder);
      return recorder;
    },
    resolveInputs: (trackId) =>
      inputs[trackId] ?? { video: undefined, audio: undefined },
    now: () => clock.now,
  };
  return { deps, clock, recorders, streams };
}

describe("recording formats", () => {
  it("picks the first supported format for the tracks recorded", () => {
    const supported = (types: string[]) => (type: string) =>
      types.includes(type);
    assert.equal(
      pickRecorderMimeType(
        true,
        true,
        supported(["video/webm;codecs=vp8,opus", "video/mp4"]),
      ),
      "video/webm;codecs=vp8,opus",
    );
    assert.equal(
      pickRecorderMimeType(false, true, supported(["audio/mp4"])),
      "audio/mp4",
    );
    assert.equal(pickRecorderMimeType(true, false, supported([])), undefined);
    assert.equal(recordingExtension("video/webm;codecs=vp9"), "webm");
    assert.equal(recordingExtension("video/mp4"), "mp4");
    assert.equal(recordingExtension("audio/mp4"), "m4a");
  });
});

describe("recording inputs", () => {
  it("lists attached cameras and microphones by ID", () => {
    assert.deepEqual(
      availableInputs([
        { kind: "videoinput", deviceId: "cam" },
        { kind: "audioinput", deviceId: "mic" },
        { kind: "audiooutput", deviceId: "speaker" },
      ]),
      { video: ["cam"], audio: ["mic"] },
    );
  });

  it("builds getUserMedia constraints, or none when both are None", () => {
    assert.deepEqual(
      getRecordMediaConstraints({ video: "cam", audio: undefined }),
      { video: { deviceId: { exact: "cam" } }, audio: true },
    );
    assert.deepEqual(getRecordMediaConstraints({ video: null, audio: "mic" }), {
      video: false,
      audio: { deviceId: { exact: "mic" } },
    });
    assert.equal(getRecordMediaConstraints({ video: null, audio: null }), null);
  });
});

describe("RecordingSession", () => {
  it("records every armed track from its inputs, all started together", async () => {
    const { deps, clock, recorders } = setup({
      a: { video: "cam", audio: "mic" },
      b: { video: null, audio: "mic" },
    });
    const { session, failures, skipped } = await RecordingSession.open(
      ["a", "b"],
      deps,
    );
    assert.deepEqual(failures, []);
    assert.deepEqual(skipped, []);
    assert.deepEqual(
      session.getTakes().map((take) => [take.trackId, take.hasVideo]),
      [
        ["a", true],
        ["b", false],
      ],
    );
    assert.deepEqual(
      recorders.map((recorder) => recorder.mimeType),
      ["video/webm", "audio/webm"],
    );
    assert.ok(recorders.every((recorder) => recorder.state === "inactive"));

    session.start();
    assert.deepEqual(
      recorders.map((recorder) => recorder.startedAt),
      [1000, 1000],
    );
    clock.now = 3500;
    const finished = await session.stop();
    assert.deepEqual(
      finished.map((take) => [take.trackId, take.durationSeconds]),
      [
        ["a", 2.5],
        ["b", 2.5],
      ],
    );
    assert.equal(await finished[0]?.blob.text(), "take from 1000");
    assert.equal(finished[0]?.blob.type, "video/webm");
  });

  it("releases the devices when it stops", async () => {
    const { deps, streams } = setup({ a: { video: "cam", audio: null } });
    const { session } = await RecordingSession.open(["a"], deps);
    session.start();
    await session.stop();
    assert.ok(streams.get("cam")?.tracks.every((track) => track.stopped));
  });

  it("skips tracks whose inputs are both None", async () => {
    const { deps, recorders } = setup({ a: { video: null, audio: null } });
    const { session, skipped } = await RecordingSession.open(["a"], deps);
    assert.deepEqual(skipped, ["a"]);
    assert.equal(session.isEmpty, true);
    assert.equal(recorders.length, 0);
  });

  it("reports a denied device and records the other tracks", async () => {
    const { deps } = setup(
      {
        a: { video: "cam", audio: null },
        b: { video: null, audio: "mic" },
      },
      { deny: ["cam"] },
    );
    const { session, failures } = await RecordingSession.open(["a", "b"], deps);
    assert.deepEqual(failures, [
      {
        trackId: "a",
        message: "access to the camera or microphone was denied",
      },
    ]);
    assert.deepEqual(
      session.getTakes().map((take) => take.trackId),
      ["b"],
    );
  });

  it("ends a track whose device goes away, keeping what it recorded", async () => {
    const { deps, clock, recorders, streams } = setup({
      a: { video: "cam", audio: null },
      b: { video: null, audio: "mic" },
    });
    const ended: string[] = [];
    const { session } = await RecordingSession.open(["a", "b"], deps, {
      onTrackEnded: (trackId, message) => ended.push(`${trackId}: ${message}`),
    });
    session.start();
    clock.now = 2000;
    streams.get("cam")?.tracks[0]?.end();
    assert.deepEqual(ended, ["a: its camera or microphone was disconnected"]);
    assert.equal(recorders[0]?.state, "inactive");
    assert.equal(recorders[1]?.state, "recording");

    clock.now = 5000;
    const finished = await session.stop();
    assert.deepEqual(
      finished.map((take) => [take.trackId, take.durationSeconds]),
      [
        ["a", 1],
        ["b", 4],
      ],
    );
  });

  it("stops only once", async () => {
    const { deps } = setup({ a: { video: "cam", audio: null } });
    const { session } = await RecordingSession.open(["a"], deps);
    session.start();
    assert.equal((await session.stop()).length, 1);
    assert.deepEqual(await session.stop(), []);
  });
});
