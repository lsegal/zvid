/// <reference lib="dom" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { gainStageAt } from "../fx/effects/gain/processor.ts";
import type {
  ChainMessage,
  ChainNodeOptions,
  ChainReport,
} from "./chain-node.ts";
import {
  DELAY,
  ONE_POLE,
  REVERSE,
  TEST_PROCESSORS,
  testStage,
} from "./chain-test-utils.ts";
import { PreviewAudioMixer } from "./preview-mixer.ts";
import { DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import type { AudioMix, AudioMixClip } from "./resolve.ts";
import { transientLevel, watchTransient } from "./transient-monitor.ts";

class FakeElement {
  // Where the test's clock is. A slow browser's seeks land `seekSeconds`
  // after they are made, on a later `tick`; otherwise they land at once.
  // It also loads an element `loadSeconds` after making it, and plays
  // nothing until then.
  static now = 0;
  static seekSeconds = 0;
  static loadSeconds = 0;
  private readonly loadsAt = FakeElement.now + FakeElement.loadSeconds;
  readonly localName: string;
  playsInline = false;
  src = "";
  crossOrigin = "";
  preload = "";
  playbackRate = 1;
  volume = 1;
  muted = false;
  paused = true;
  seeking = false;
  seeks = 0;
  seeksWhileSeeking = 0;
  private time = 0;
  private landsAt = 0;
  private listeners = new Map<string, Array<() => void>>();

  constructor(localName = "audio") {
    this.localName = localName;
  }

  get readyState() {
    return FakeElement.now >= this.loadsAt ? 4 : 0;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.seeks += 1;
    if (this.seeking) {
      this.seeksWhileSeeking += 1;
    }
    this.time = value;
    this.seeking = FakeElement.seekSeconds > 0;
    this.landsAt = FakeElement.now + FakeElement.seekSeconds;
  }

  // Plays on `seconds`, or lands a seek once it is due.
  tick(seconds: number) {
    if (this.seeking) {
      if (FakeElement.now >= this.landsAt) {
        this.seeking = false;
        for (const listener of this.listeners.get("seeked") ?? []) {
          listener();
        }
      }
    } else if (!this.paused && this.readyState > 0) {
      this.time += seconds * this.playbackRate;
    }
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

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

class FakeWorkletNode {
  static made: FakeWorkletNode[] = [];
  readonly options: { processorOptions: ChainNodeOptions };
  readonly messages: ChainMessage[] = [];
  readonly port = {
    onmessage: null as ((event: { data: ChainReport }) => void) | null,
    postMessage: (message: ChainMessage) => {
      this.messages.push(message);
    },
  };
  connections: unknown[] = [];

  constructor(
    _context: unknown,
    _name: string,
    options: { processorOptions: ChainNodeOptions },
  ) {
    this.options = options;
    FakeWorkletNode.made.push(this);
  }

  connect(node: unknown) {
    this.connections.push(node);
  }

  disconnect() {
    this.connections = [];
  }
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  readonly sampleRate = 48_000;
  currentTime = 0;
  modules: string[] = [];
  readonly audioWorklet = {
    addModule: (url: string) => {
      this.modules.push(url);
      return Promise.resolve();
    },
  };
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
    AudioWorkletNode: globalThis.AudioWorkletNode,
    document: globalThis.document,
  };
  beforeEach(() => {
    FakeAudioContext.last = null;
    FakeWorkletNode.made = [];
    FakeElement.now = 0;
    FakeElement.seekSeconds = 0;
    FakeElement.loadSeconds = 0;
    globalThis.AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    globalThis.AudioWorkletNode =
      FakeWorkletNode as unknown as typeof AudioWorkletNode;
    globalThis.document = {
      createElement: (tag: string) => new FakeElement(tag),
    } as unknown as Document;
  });
  afterEach(() => {
    globalThis.AudioContext = originals.AudioContext;
    globalThis.AudioWorkletNode = originals.AudioWorkletNode;
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

  it("lets back-to-back short clips that start late land their seeks", () => {
    // A slow main thread syncs every 0.25 s, so each clip starts 0.2 s late,
    // and seeks take 0.3 s to land.
    FakeElement.seekSeconds = 0.3;
    const length = 1.5;
    const starts = [1, 2.5, 4, 5.5];
    const mixer = new PreviewAudioMixer();
    mixer.update(
      mix(
        starts.map((startSeconds, index) =>
          clip({
            id: `clip-${index}`,
            startSeconds,
            durationSeconds: length,
            sourceOffsetSeconds: -startSeconds,
            sourceWindowEndSeconds: length,
          }),
        ),
      ),
      media,
    );
    const step = 0.05;
    const drifts: number[] = [];
    for (let tick = 0; tick * step <= 7; tick += 1) {
      const now = tick * step;
      FakeElement.now = now;
      if (FakeAudioContext.last) {
        context().currentTime = now;
      }
      for (const { element } of FakeAudioContext.last?.sources ?? []) {
        element.tick(step);
      }
      if (tick % 5 === 4) {
        mixer.sync(playing(now));
      }
      // How far the playing clip is from the playhead over its last half.
      const index = starts.findIndex(
        (start) => now >= start + length / 2 && now < start + length,
      );
      const element = FakeAudioContext.last?.sources[index]?.element;
      if (element && !element.seeking) {
        drifts.push(Math.abs(element.currentTime - (now - starts[index])));
      }
    }

    const elements = context().sources.map((source) => source.element);
    assert.equal(elements.length, starts.length);
    for (const element of elements) {
      assert.equal(element.seeksWhileSeeking, 0);
    }
    // The first clip seeks twice: once from behind, and once leading by how
    // long that took. Later clips lead from the start, so seek once each.
    assert.deepEqual(
      elements.map((element) => element.seeks),
      [2, 1, 1, 1],
    );
    assert.ok(drifts.length > 0);
    assert.ok(Math.max(...drifts) < 0.1, `drifts ${drifts}`);
    mixer.dispose();
  });

  it("plays back-to-back short clips of the same media with the loaded element of the clip before", () => {
    // A starved main thread syncs every 0.25 s, seeks take 0.3 s to land,
    // and a new element takes longer to load than a clip lasts. The clips
    // play on through the music, each through its own gain.
    FakeElement.seekSeconds = 0.3;
    FakeElement.loadSeconds = 2;
    const length = 1.5;
    const starts = [1, 2.5, 4, 5.5, 7];
    const amplitudes = [0.5, 0.25, 0.75, 0.125, 0.625];
    const mixer = new PreviewAudioMixer();
    mixer.update(
      mix(
        starts.map((startSeconds, index) =>
          clip({
            id: `clip-${index}`,
            amplitude: amplitudes[index],
            startSeconds,
            durationSeconds: length,
            sourceWindowStartSeconds: startSeconds,
            sourceWindowEndSeconds: startSeconds + length,
          }),
        ),
      ),
      media,
    );
    const step = 0.05;
    let heard = 0;
    let silent: number[] = [];
    for (let tick = 0; tick * step <= 8.5; tick += 1) {
      const now = tick * step;
      FakeElement.now = now;
      if (FakeAudioContext.last) {
        context().currentTime = now;
      }
      for (const { element } of FakeAudioContext.last?.sources ?? []) {
        element.tick(step);
      }
      if (tick % 5 === 4) {
        mixer.sync(playing(now));
      }
      // Every clip after the first, which has nothing loaded to take over,
      // is heard through its own gain from its first sync on.
      const index = starts.findIndex(
        (start) => now >= start + 0.25 && now < start + length,
      );
      if (index < 1) {
        continue;
      }
      const audible = context().sources.some(
        ({ element, connections }) =>
          element.readyState > 0 &&
          !element.paused &&
          !element.seeking &&
          Math.abs(element.currentTime - now) < 0.2 &&
          connections[0]?.gain?.value === amplitudes[index],
      );
      if (audible) {
        heard += 1;
      } else {
        silent = [...silent, now];
      }
    }
    assert.deepEqual(silent, []);
    assert.ok(heard > 0);
    // The clip before's element plays straight on, without a seek.
    const seeks = context().sources.map(({ element }) => element.seeks);
    assert.ok(
      seeks.slice(1).every((count) => count <= 1),
      `seeks ${seeks}`,
    );
    mixer.dispose();
  });

  it("seeks a scrub at once, even while a seek is landing", () => {
    FakeElement.seekSeconds = 0.3;
    const mixer = new PreviewAudioMixer();
    mixer.update(mix([clip({})]), media);
    const scrubbing = (playheadSeconds: number) => ({
      ...playing(playheadSeconds),
      isPlaying: false,
      isScrubbing: true,
      isAudibleScrubbing: true,
    });
    mixer.sync(scrubbing(1));
    mixer.sync(scrubbing(1.5));
    const element = elementOf("a");
    assert.ok(element);
    assert.equal(element.currentTime, 1.5);
    assert.equal(element.seeks, 2);
    mixer.dispose();
  });

  describe("with audio effects beyond Gain", () => {
    const filtered = (cutoff = 500) =>
      mix([
        clip({
          amplitude: 0.5,
          stages: [gainStageAt(0.5), testStage(ONE_POLE, { Cutoff: cutoff })],
        }),
      ]);

    async function chainedMixer() {
      const mixer = new PreviewAudioMixer({
        workletUrl: "chain-worklet.js",
        registry: TEST_PROCESSORS,
      });
      mixer.update(filtered(), media);
      // The first sync loads the worklet, and plays nothing until it has.
      mixer.sync(playing(1));
      assert.equal(context().sources.length, 0);
      await Promise.resolve();
      mixer.sync(playing(1.1));
      return mixer;
    }

    it("runs the clip, its track's bus and the master through worklet chains", async () => {
      const mixer = await chainedMixer();
      assert.deepEqual(context().modules, ["chain-worklet.js"]);
      const [master, clipChain, bus] = FakeWorkletNode.made;
      assert.ok(master && clipChain && bus);
      // element → clip gain → clip chain → bus chain → master chain → master
      // gain, which leaves the master's Gains to its chain.
      const [source] = context().sources;
      const input = source.connections[0];
      assert.equal(input.gain?.value, 1);
      assert.deepEqual(input.connections, [clipChain]);
      assert.deepEqual(clipChain.connections, [bus]);
      assert.deepEqual(bus.connections, [master]);
      assert.deepEqual(master.connections, [context().gains[0]]);
      assert.equal(context().gains[0].gain?.value, 1);
      // Each node starts with its settings, so it never plays unconfigured.
      assert.deepEqual(clipChain.options.processorOptions.settings, {
        stages: filtered().clips[0].stages,
        inputGain: 1,
        delayFrames: 0,
      });
      assert.deepEqual(bus.options.processorOptions.settings.stages, []);
      assert.deepEqual(
        master.options.processorOptions.settings.stages,
        filtered().master,
      );
      mixer.dispose();
    });

    it("posts an edit to the chain it changes, once", async () => {
      const mixer = await chainedMixer();
      const clipChain = FakeWorkletNode.made[1];
      mixer.update(filtered(900), media);
      mixer.update(filtered(900), media);
      const configures = clipChain.messages.filter(
        (message) => message.type === "configure",
      );
      assert.equal(configures.length, 1);
      assert.equal(
        configures[0].type === "configure" &&
          configures[0].settings.stages[1].numbers.Cutoff,
        900,
      );
      mixer.dispose();
    });

    it("tells the chains where the timeline is, and resets them on a seek", async () => {
      const mixer = await chainedMixer();
      const master = FakeWorkletNode.made[0];
      assert.deepEqual(master.messages.at(-1), {
        type: "transport",
        contextTime: 0,
        timelineSeconds: 1.1,
        rate: 1,
      });
      master.messages.length = 0;
      // Playing on as expected says nothing new.
      context().currentTime = 0.5;
      mixer.sync(playing(1.6));
      const types = () => master.messages.map((message) => message.type);
      assert.deepEqual(types(), []);

      mixer.sync(playing(3));
      assert.deepEqual(types(), ["reset", "transport"]);
      mixer.dispose();
    });

    it("asks the chains for watched Transient levels and takes their reports", async () => {
      const unwatchEarly = watchTransient("early");
      const mixer = await chainedMixer();
      const [master, clipChain] = FakeWorkletNode.made;
      assert.deepEqual(master.options.processorOptions.watch, ["early"]);

      const unwatch = watchTransient("filter");
      assert.deepEqual(clipChain.messages.at(-1), {
        type: "watch",
        ids: ["early", "filter"],
      });
      clipChain.port.onmessage?.({
        data: { type: "transients", levels: [["filter", 0.4]] },
      });
      assert.equal(transientLevel("filter"), 0.4);

      unwatch();
      unwatchEarly();
      assert.deepEqual(master.messages.at(-1), { type: "watch", ids: [] });
      assert.equal(transientLevel("filter"), 0);
      mixer.dispose();
      // A disposed mixer tells its chains nothing more.
      const count = master.messages.length;
      watchTransient("late")();
      assert.equal(master.messages.length, count);
    });

    // An effect on the first clip only, and the second's own stack.
    const partly = (dry = [gainStageAt(0.25)], wet = [testStage(ONE_POLE)]) =>
      mix([
        clip({ id: "wet", amplitude: 0.5, stages: [gainStageAt(0.5), ...wet] }),
        clip({ id: "dry", mediaId: "b", amplitude: 0.25, stages: dry }),
      ]);
    const added = testStage(ONE_POLE, { Cutoff: 800 }, { id: "added" });

    async function partlyChainedMixer() {
      const mixer = new PreviewAudioMixer({
        workletUrl: "chain-worklet.js",
        registry: TEST_PROCESSORS,
      });
      mixer.update(partly(), media);
      mixer.sync(playing(1));
      await Promise.resolve();
      mixer.sync(playing(1.1));
      const dry = context().sources.find(
        (source) => source.element === elementOf("b"),
      );
      assert.ok(dry);
      return { mixer, input: dry.connections[0] };
    }

    it("skips the chain of a clip whose own stack is steady Gain alone", async () => {
      const { mixer, input } = await partlyChainedMixer();
      const [, , bus] = FakeWorkletNode.made;
      // The master, the effected clip's chain and the bus: none for the
      // other clip, whose gain applies its own Gain and feeds the bus.
      assert.equal(FakeWorkletNode.made.length, 3);
      assert.equal(input.gain?.value, 0.25);
      assert.deepEqual(input.connections, [bus]);
      mixer.dispose();
    });

    it("gives a clip a chain when its path is delayed to line up", async () => {
      const mixer = new PreviewAudioMixer({
        workletUrl: "chain-worklet.js",
        registry: TEST_PROCESSORS,
      });
      mixer.update(
        partly(undefined, [testStage(DELAY, { Frames: 64 })]),
        media,
      );
      mixer.sync(playing(1));
      await Promise.resolve();
      mixer.sync(playing(1.1));
      assert.equal(FakeWorkletNode.made.length, 4);
      const dryChain = FakeWorkletNode.made[3];
      assert.equal(dryChain.options.processorOptions.settings.delayFrames, 64);
      mixer.dispose();
    });

    it("inserts a chain when an effect is added, crossfading the effect in", async () => {
      const { mixer, input } = await partlyChainedMixer();
      const [, , bus] = FakeWorkletNode.made;
      const sources = context().sources.length;
      mixer.update(partly([gainStageAt(0.25), added]), media);
      const chain = FakeWorkletNode.made[3];
      assert.ok(chain);
      // The element plays on, now through the chain.
      assert.equal(context().sources.length, sources);
      assert.equal(input.gain?.value, 1);
      assert.deepEqual(input.connections, [chain]);
      assert.deepEqual(chain.connections, [bus]);
      // It starts sounding as the gain did, with its Gain and the effect
      // bypassed, then turns the effect on, which the chain crossfades.
      const { stages } = chain.options.processorOptions.settings;
      assert.deepEqual(stages, [
        gainStageAt(0.25),
        { ...added, enabled: false },
      ]);
      const configure = chain.messages.find(
        (message) => message.type === "configure",
      );
      assert.deepEqual(
        configure?.type === "configure" && configure.settings.stages,
        [gainStageAt(0.25), added],
      );
      mixer.dispose();
    });

    it("drops a chain once the effect taken off its clip has drained", async () => {
      const { mixer, input } = await partlyChainedMixer();
      const [, , bus] = FakeWorkletNode.made;
      mixer.update(partly([gainStageAt(0.25), added]), media);
      const chain = FakeWorkletNode.made[3];
      mixer.update(partly(), media);
      // The chain plays out the effect's tail first.
      const configures = chain.messages.filter(
        (message) => message.type === "configure",
      );
      assert.deepEqual(
        configures.at(-1)?.type === "configure" &&
          configures.at(-1)?.settings.stages,
        [gainStageAt(0.25)],
      );
      context().currentTime = 0.1;
      mixer.sync(playing(1.2));
      assert.deepEqual(input.connections, [chain]);

      context().currentTime = 0.2;
      mixer.sync(playing(1.3));
      assert.deepEqual(input.connections, [bus]);
      assert.equal(input.gain?.value, 0.25);
      assert.deepEqual(chain.connections, []);
      mixer.dispose();
    });

    it("plays Gain alone through native gains without the worklet", () => {
      const mixer = new PreviewAudioMixer({ registry: TEST_PROCESSORS });
      mixer.update(filtered(), media);
      mixer.sync(playing(1));
      assert.equal(FakeWorkletNode.made.length, 0);
      const [source] = context().sources;
      assert.equal(source.connections[0].gain?.value, 0.5);
      assert.deepEqual(source.connections[0].connections, [context().gains[0]]);
      mixer.dispose();
    });
  });

  describe("with video media", () => {
    const videoMedia = [
      { id: "v", previewUrl: "blob:v", kind: "video" },
      { id: "a", previewUrl: "blob:a", kind: "audio" },
    ];
    // The placement of `clip({ mediaId })` as the compositor draws it.
    const drawn = (mediaId: string, startSeconds = 0) => ({
      mediaId,
      startSeconds,
      durationSeconds: 4,
      sourceOffsetSeconds: -startSeconds,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 4,
    });
    const stopped = (playheadSeconds: number) => ({
      ...playing(playheadSeconds),
      isPlaying: false,
    });

    it("plays a video clip from a <video> the compositor draws, once", () => {
      let changes = 0;
      const mixer = new PreviewAudioMixer({
        onVideoElementsChange: () => {
          changes += 1;
        },
      });
      mixer.update(
        mix([
          clip({ id: "picture", mediaId: "v" }),
          clip({ id: "song", mediaId: "a" }),
        ]),
        videoMedia,
      );
      mixer.sync(playing(1));
      const video = elementOf("v");
      const audio = elementOf("a");
      assert.ok(video && audio);
      assert.equal(video.localName, "video");
      assert.equal(video.playsInline, true);
      // Muted, it would feed silence into the mix.
      assert.equal(video.muted, false);
      assert.equal(audio.localName, "audio");
      assert.equal(context().sources.length, 2);
      assert.equal(
        mixer.videoElementFor(drawn("v")),
        video as unknown as HTMLVideoElement,
      );
      assert.equal(mixer.videoElementFor(drawn("v", 1)), undefined);
      assert.equal(mixer.videoElementFor(drawn("a")), undefined);
      assert.deepEqual(mixer.videoElements(), [video]);
      assert.equal(changes, 1);

      mixer.update(mix([clip({ id: "song", mediaId: "a" })]), videoMedia);
      assert.deepEqual(mixer.videoElements(), []);
      assert.equal(video.src, "");
      assert.equal(changes, 2);
      mixer.dispose();
    });

    it("says which drawn clips it plays from a video element", () => {
      const mixer = new PreviewAudioMixer({ registry: TEST_PROCESSORS });
      mixer.update(
        mix([
          clip({ id: "loud", mediaId: "v" }),
          clip({ id: "song", mediaId: "a" }),
        ]),
        videoMedia,
      );
      assert.equal(mixer.playsVideoOf(drawn("v")), true);
      // Another placement, audio-only media, or no media at all.
      assert.equal(mixer.playsVideoOf(drawn("v", 2)), false);
      assert.equal(mixer.playsVideoOf(drawn("a")), false);
      assert.equal(
        mixer.playsVideoOf({ ...drawn("v"), mediaId: undefined }),
        false,
      );

      // Turned down once its element is made, it keeps playing from it.
      mixer.sync(playing(1));
      mixer.update(
        mix([clip({ id: "loud", mediaId: "v", amplitude: 0 })]),
        videoMedia,
      );
      assert.equal(mixer.playsVideoOf(drawn("v")), true);

      // A silent clip makes no element, and a reversed one plays a decoded
      // buffer, so the compositor keeps its own.
      mixer.update(mix([clip({ mediaId: "v", amplitude: 0 })]), videoMedia);
      assert.equal(mixer.playsVideoOf(drawn("v")), false);
      mixer.update(
        mix([
          clip({
            mediaId: "v",
            stages: [gainStageAt(1), testStage(REVERSE)],
          }),
        ]),
        videoMedia,
      );
      assert.equal(mixer.playsVideoOf(drawn("v")), false);
      mixer.dispose();
    });

    it("stops a video element on the playhead and leads it by the chain latency while playing", async () => {
      const mixer = new PreviewAudioMixer({
        workletUrl: "chain-worklet.js",
        registry: TEST_PROCESSORS,
      });
      // 4800 frames at 48 kHz: the mix comes out 0.1 s late.
      const delayed = (mediaId: string) =>
        clip({
          id: mediaId,
          mediaId,
          stages: [gainStageAt(1), testStage(DELAY, { Frames: 4800 })],
        });
      mixer.update(mix([delayed("v"), delayed("a")]), videoMedia);
      mixer.sync(stopped(1));
      await Promise.resolve();
      mixer.sync(stopped(1));
      const video = elementOf("v");
      const audio = elementOf("a");
      assert.ok(video && audio);
      assert.equal(video.currentTime, 1);
      assert.equal(audio.currentTime, 1.1);

      mixer.sync(playing(1));
      assert.equal(video.paused, false);
      assert.ok(Math.abs(video.currentTime - 1.1) < 1e-9);
      // Once playing, it is inside the drift tolerance and left to play.
      video.tick(0.5);
      mixer.sync(playing(1.5));
      assert.ok(Math.abs(video.currentTime - 1.6) < 1e-9);
      assert.equal(video.seeks, 2);
      mixer.dispose();
    });

    it("queues a scrub's seeks on a video element behind the one landing", () => {
      FakeElement.seekSeconds = 0.3;
      const mixer = new PreviewAudioMixer();
      mixer.update(mix([clip({ mediaId: "v" })]), videoMedia);
      const scrubbing = (playheadSeconds: number) => ({
        ...stopped(playheadSeconds),
        isScrubbing: true,
      });
      mixer.sync(scrubbing(1));
      mixer.sync(scrubbing(1.5));
      mixer.sync(scrubbing(2));
      const video = elementOf("v");
      assert.ok(video);
      assert.equal(video.seeks, 1);
      assert.equal(video.seeksWhileSeeking, 0);

      FakeElement.now = 0.3;
      video.tick(0);
      assert.equal(video.currentTime, 2);
      assert.equal(video.seeks, 2);
      mixer.dispose();
    });
    it("plays short audio-only clips from decoded buffers where it prefers them", () => {
      const withLong = [
        ...videoMedia,
        { id: "b", previewUrl: "blob:b", kind: "audio" },
      ];
      const clips = mix([
        clip({ id: "short", mediaId: "a", mediaDurationSeconds: 10 }),
        clip({ id: "video", mediaId: "v", mediaDurationSeconds: 10 }),
        clip({ id: "long", mediaId: "b", mediaDurationSeconds: 600 }),
      ]);
      const preferring = new PreviewAudioMixer({ preferDecodedAudio: true });
      preferring.update(clips, withLong);
      preferring.sync(playing(1));
      // A video clip's element is the compositor's too, and long media
      // would take too much memory decoded.
      assert.equal(elementOf("a"), undefined);
      assert.ok(elementOf("v"));
      assert.ok(elementOf("b"));
      preferring.dispose();

      // Outside WebKit, every clip read forwards plays from its element.
      const mixer = new PreviewAudioMixer();
      mixer.update(clips, withLong);
      mixer.sync(playing(1));
      assert.ok(elementOf("a"));
      mixer.dispose();
    });
  });
});
