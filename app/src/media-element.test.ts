/// <reference lib="dom" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LiveAudioBands } from "./fx-shaders/audio-bands.ts";
import { applyPreviewVolume } from "./media-element.ts";

type FakeElement = { volume: number; muted: boolean };

// A Web Audio graph whose analyser hears the routed element at its own
// volume, as some browsers do, so turning the element down would quiet the
// bands too.
class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  readonly sampleRate = 48_000;
  readonly destination = {};
  state = "running";
  element: FakeElement | null = null;
  gain = { gain: { value: 1 }, connect() {} };

  constructor() {
    FakeAudioContext.last = this;
  }

  createAnalyser() {
    const context = this;
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      minDecibels: 0,
      maxDecibels: 0,
      connect() {},
      getByteFrequencyData(bins: Uint8Array) {
        const level = context.element?.muted
          ? 0
          : (context.element?.volume ?? 0);
        bins.forEach((_, index) => {
          bins[index] = index < 40 ? Math.round(220 * level) : 0;
        });
      },
    };
  }

  createGain() {
    return this.gain;
  }

  createMediaElementSource(element: FakeElement) {
    this.element = element;
    return { connect() {}, disconnect() {} };
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

function element() {
  return { volume: 1, muted: false } as FakeElement & HTMLMediaElement;
}

describe("preview volume on media elements", () => {
  const original = globalThis.AudioContext;
  beforeEach(() => {
    globalThis.AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
  });
  afterEach(() => {
    globalThis.AudioContext = original;
  });

  it("sets the element's own volume when it isn't routed", () => {
    const audio = element();
    applyPreviewVolume(audio, { volume: 0.3, muted: false });
    assert.deepEqual({ ...audio }, { volume: 0.3, muted: false });
    applyPreviewVolume(
      audio,
      { volume: 0.3, muted: true },
      new LiveAudioBands(),
    );
    assert.deepEqual({ ...audio }, { volume: 0.3, muted: true });
    assert.doesNotThrow(() =>
      applyPreviewVolume(null, { volume: 0.3, muted: false }),
    );
  });

  it("turns down the gain after the analyser, leaving the bands alone", () => {
    const audio = element();
    const bands = new LiveAudioBands();
    bands.attach(audio);
    const context = FakeAudioContext.last as FakeAudioContext;

    applyPreviewVolume(audio, { volume: 1, muted: false }, bands);
    const loud = bands.sample(0);

    for (const volume of [
      { volume: 0.2, muted: false },
      { volume: 0.8, muted: true },
    ]) {
      applyPreviewVolume(audio, volume, bands);
      assert.deepEqual({ ...audio }, { volume: 1, muted: false });
      assert.equal(context.gain.gain.value, volume.muted ? 0 : volume.volume);
      assert.deepEqual(bands.sample(0), loud);
    }
    bands.dispose();
  });

  it("only routes volume for the element the analyser is attached to", () => {
    const bands = new LiveAudioBands();
    bands.attach(element());
    assert.equal(bands.setOutputGain(element(), 0.5), false);
    bands.dispose();
  });
});
