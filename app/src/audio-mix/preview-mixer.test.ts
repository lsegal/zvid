/// <reference lib="dom" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { gainStageAt } from "../fx/effects/gain/processor.ts";
import { PreviewAudioMixer } from "./preview-mixer.ts";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import type { AudioMix, AudioMixClip } from "./resolve.ts";

class FakeElement {
  src = "";
  crossOrigin = "";
  preload = "";
  currentTime = 0;
  playbackRate = 1;
  volume = 1;
  muted = false;
  paused = true;

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
    }
  }

  load() {}
}

type FakeNode = {
  gain?: { value: number };
  connections: FakeNode[];
  connect(node: FakeNode): void;
  disconnect(): void;
};

function node(extra: object = {}): FakeNode {
  return {
    ...extra,
    connections: [],
    connect(target: FakeNode) {
      this.connections.push(target);
    },
    disconnect() {
      this.connections = [];
    },
  };
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  readonly sampleRate = 48_000;
  readonly destination = node();
  state = "suspended";
  gains: FakeNode[] = [];
  sources: Array<FakeNode & { element: FakeElement }> = [];
  analyser: FakeNode | null = null;

  constructor() {
    FakeAudioContext.last = this;
  }

  createGain() {
    const gain = node({ gain: { value: 1 } });
    this.gains.push(gain);
    return gain;
  }

  createChannelSplitter() {
    return node();
  }

  createWaveShaper() {
    return node({ curve: null });
  }

  createAnalyser() {
    this.analyser = node();
    return this.analyser;
  }

  createMediaElementSource(element: FakeElement) {
    const source = { ...node(), element };
    this.sources.push(source);
    return source;
  }

  resume() {
    this.state = "running";
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

const media = [
  { id: "a", previewUrl: "blob:a" },
  { id: "b", previewUrl: "blob:b" },
];

function clip(overrides: Partial<AudioMixClip>): AudioMixClip {
  return {
    id: "clip",
    mediaId: "a",
    startSeconds: 0,
    durationSeconds: 4,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 4,
    effects: [],
    hasGain: true,
    busId: "bus",
    ...overrides,
    amplitude: overrides.amplitude ?? 1,
    // A Gain at its amplitude, as resolving a clip with one gives it.
    stages: overrides.stages ?? [gainStageAt(overrides.amplitude ?? 1)],
  };
}

function mix(clips: AudioMixClip[], masterAmplitude = 1): AudioMix {
  return {
    clips,
    buses: [{ id: "bus", stages: [] }],
    master: [gainStageAt(masterAmplitude)],
    masterAmplitude,
    fromSourceTracks: true,
    bpm: 120,
    signature: DEFAULT_TIME_SIGNATURE,
  };
}

function playing(playheadSeconds: number) {
  return {
    playheadSeconds,
    isPlaying: true,
    isScrubbing: false,
    isAudibleScrubbing: false,
    isContinuousScrubbing: false,
  };
}

function context() {
  return FakeAudioContext.last as FakeAudioContext;
}

function elementOf(mediaId: string) {
  return context().sources.find(
    (source) => source.element.src === `blob:${mediaId}`,
  )?.element;
}

describe("PreviewAudioMixer", () => {
  const originals = {
    AudioContext: globalThis.AudioContext,
    document: globalThis.document,
  };
  beforeEach(() => {
    FakeAudioContext.last = null;
    globalThis.AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    globalThis.document = {
      createElement: () => new FakeElement(),
    } as unknown as Document;
  });
  afterEach(() => {
    globalThis.AudioContext = originals.AudioContext;
    globalThis.document = originals.document;
  });

  it("plays every clip under the playhead through its own gain", () => {
    const mixer = new PreviewAudioMixer();
    mixer.update(
      mix([
        clip({ id: "one", mediaId: "a", amplitude: 0.5 }),
        clip({
          id: "two",
          mediaId: "b",
          amplitude: 0.25,
          startSeconds: 1,
          sourceOffsetSeconds: -1,
        }),
      ]),
      media,
    );
    mixer.sync(playing(2));

    const a = elementOf("a");
    const b = elementOf("b");
    assert.ok(a && b);
    assert.equal(a.paused, false);
    assert.equal(b.paused, false);
    assert.equal(a.currentTime, 2);
    assert.equal(b.currentTime, 1);
    // Routed elements play at full volume; their clip gains set the level.
    assert.equal(a.volume, 1);
    const gains = context().sources.map(
      (source) => source.connections[0].gain?.value,
    );
    assert.deepEqual(gains, [0.5, 0.25]);
    assert.equal(context().state, "running");
    mixer.dispose();
  });

  it("makes no element for a clip without Gain until it is turned up", () => {
    const mixer = new PreviewAudioMixer();
    mixer.update(mix([clip({ amplitude: 0 })]), media);
    mixer.sync(playing(1));
    assert.equal(FakeAudioContext.last, null);

    mixer.update(mix([clip({ amplitude: 0.5 })]), media);
    mixer.sync(playing(1.1));
    assert.equal(context().sources.length, 1);

    // Turning it down again applies at once, without a new element.
    mixer.update(mix([clip({ amplitude: 0 })], 0.5), media);
    assert.equal(context().sources[0].connections[0].gain?.value, 0);
    mixer.dispose();
  });

  it("waits at a clip's first sound before it starts and stops it after", () => {
    const mixer = new PreviewAudioMixer();
    mixer.update(
      mix([
        clip({
          startSeconds: 2,
          durationSeconds: 1,
          sourceOffsetSeconds: -1,
          sourceWindowStartSeconds: 1,
          sourceWindowEndSeconds: 2,
        }),
      ]),
      media,
    );
    mixer.sync(playing(1));
    const element = elementOf("a");
    assert.ok(element);
    assert.equal(element.paused, true);
    assert.equal(element.currentTime, 1);

    mixer.sync(playing(3.5));
    assert.equal(element.paused, true);

    // Far past the clip its element is released.
    mixer.sync(playing(10));
    assert.equal(element.src, "");
  });

  it("pauses at the playhead when playback stops", () => {
    const mixer = new PreviewAudioMixer();
    mixer.update(mix([clip({})]), media);
    mixer.sync(playing(1));
    mixer.sync({ ...playing(1.5), isPlaying: false });
    const element = elementOf("a");
    assert.ok(element);
    assert.equal(element.paused, true);
    assert.equal(element.currentTime, 1.5);
    mixer.dispose();
  });

  it("sets the preview volume after the analyser, and the master gain before it", () => {
    const mixer = new PreviewAudioMixer();
    mixer.update(mix([clip({})], 0.5), media);
    mixer.setVolume({ volume: 0.3, muted: false });
    mixer.sync(playing(1));

    const analyser = context().analyser as FakeNode;
    const [output] = analyser.connections;
    assert.equal(output.gain?.value, 0.3);
    assert.equal(mixer.analyser, analyser);
    mixer.setVolume({ volume: 0.8, muted: true });
    assert.equal(output.gain?.value, 0);

    // The first gain made is the master.
    assert.equal(context().gains[0].gain?.value, 0.5);
    mixer.update(mix([clip({})], 0.25), media);
    assert.equal(context().gains[0].gain?.value, 0.25);
    mixer.dispose();
  });

  it("taps the mix for the VU meter beside the analyser, before the preview volume", () => {
    const mixer = new PreviewAudioMixer();
    mixer.update(mix([clip({})]), media);
    const before = mixer.meterTap;
    assert.equal(before, null);
    mixer.sync(playing(1));

    const tap = mixer.meterTap;
    assert.ok(tap?.left && tap.right && tap.left !== tap.right);
    // The limiter feeds both the meter's upmix and the bands' analyser.
    const limiter = context().gains[1].connections[0];
    assert.equal(limiter.connections.length, 2);
    assert.ok(limiter.connections.includes(context().analyser as FakeNode));
    mixer.dispose();
    assert.equal(mixer.meterTap, null);
  });

  it("drops a clip's element when its media changes or it leaves the mix", () => {
    const mixer = new PreviewAudioMixer();
    mixer.update(mix([clip({})]), media);
    mixer.sync(playing(1));
    const first = elementOf("a");
    assert.ok(first);

    mixer.update(mix([clip({ mediaId: "b" })]), media);
    assert.equal(first.src, "");
    mixer.sync(playing(1));
    assert.ok(elementOf("b"));

    mixer.update(mix([]), media);
    assert.equal(elementOf("b"), undefined);
    mixer.dispose();
  });
});
