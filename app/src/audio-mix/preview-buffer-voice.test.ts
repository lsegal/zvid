/// <reference lib="dom" />
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  DecodedClipVoice,
  prefersDecodedVoice,
} from "./preview-buffer-voice.ts";
import type { AudioMixClip } from "./resolve.ts";

describe("prefersDecodedVoice", () => {
  it("takes clips of media known to be at most two minutes long", () => {
    assert.equal(
      prefersDecodedVoice({ durationSeconds: 30, mediaDurationSeconds: 60 }),
      true,
    );
    assert.equal(
      prefersDecodedVoice({ durationSeconds: 30, mediaDurationSeconds: 600 }),
      false,
    );
    // A clip looping short media past the limit.
    assert.equal(
      prefersDecodedVoice({ durationSeconds: 300, mediaDurationSeconds: 10 }),
      false,
    );
    assert.equal(prefersDecodedVoice({ durationSeconds: 30 }), false);
  });
});

describe("DecodedClipVoice", () => {
  // Its media never loads; the tests stand in its buffer.
  const originalFetch = globalThis.fetch;
  before(() => {
    globalThis.fetch = () => new Promise(() => {});
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  // A voice with its buffer loaded, recording where its sources start.
  function loadedVoice(lenient: boolean) {
    const starts: number[] = [];
    const context = {
      currentTime: 0,
      createBufferSource: () => ({
        buffer: null,
        connect() {},
        disconnect() {},
        start: (_when: number, offset: number) => starts.push(offset),
        stop() {},
      }),
    };
    const voice = new DecodedClipVoice(
      context as unknown as AudioContext,
      {} as AudioMixClip,
      "blob:clip",
      120,
      {} as AudioNode,
      lenient,
    );
    (voice as unknown as { buffer: object }).buffer = {};
    return { voice, context, starts };
  }

  it("restarts in steady playback only once drift lasts", () => {
    const { voice, context, starts } = loadedVoice(false);
    voice.sync(0, 0.18, true);
    assert.deepEqual(starts, [0]);
    // A one-frame jump in the audio clock is left alone.
    context.currentTime = 1;
    voice.sync(1.5, 0.18, true);
    voice.sync(1, 0.18, true);
    assert.deepEqual(starts, [0]);
    // Drift that lasts three syncs restarts it.
    voice.sync(1.5, 0.18, true);
    voice.sync(1.5, 0.18, true);
    assert.deepEqual(starts, [0]);
    voice.sync(1.5, 0.18, true);
    assert.deepEqual(starts, [0, 1.5]);
  });

  it("restarts a scrub at once", () => {
    const { voice, context, starts } = loadedVoice(false);
    voice.sync(0, 0.035, false);
    context.currentTime = 0.1;
    voice.sync(0.2, 0.035, false);
    assert.deepEqual(starts, [0, 0.2]);
  });

  it("tolerates up to 0.6 s in steady playback where it plays by preference", () => {
    const { voice, context, starts } = loadedVoice(true);
    voice.sync(0, 0.18, true);
    context.currentTime = 1;
    for (let sync = 0; sync < 3; sync++) {
      voice.sync(1.5, 0.18, true);
    }
    assert.deepEqual(starts, [0]);
    for (let sync = 0; sync < 3; sync++) {
      voice.sync(1.7, 0.18, true);
    }
    assert.deepEqual(starts, [0, 1.7]);
  });
});
