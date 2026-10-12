/// <reference lib="dom" />
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  RE_PITCH_EFFECT_NAME,
  SEMITONES_KEY,
} from "../fx/effects/re-pitch/re-pitch.ts";
import type { ClipSpan } from "./clip-span.ts";
import {
  DecodedClipVoice,
  DecodedVoiceClock,
  decodedClipSeconds,
  prefersDecodedVoice,
  reanchoredClipSeconds,
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

  // A voice with its buffer loaded, recording where in its clip each
  // source plays as it starts.
  function loadedVoice(lenient: boolean) {
    const starts: number[] = [];
    const context = {
      currentTime: 0,
      createBufferSource: () => ({
        buffer: null,
        connect() {},
        disconnect() {},
        start: (when: number, offset: number) =>
          starts.push(
            Math.round((offset - (when - context.currentTime)) * 1e9) / 1e9,
          ),
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

describe("decodedClipSeconds", () => {
  it("hands steady playback a clip shortly before it starts, and on past its end", () => {
    assert.equal(decodedClipSeconds(1.75, 2, 3, true, true), -0.25);
    assert.equal(decodedClipSeconds(1, 2, 3, true, true), undefined);
    assert.equal(decodedClipSeconds(2.5, 2, 3, true, true), 0.5);
    // Its buffer ends with the clip, so it runs out on its own.
    assert.equal(decodedClipSeconds(3.25, 2, 3, true, true), 1.25);
  });

  it("plays a scrub only inside the clip, and nothing while stopped", () => {
    assert.equal(decodedClipSeconds(1.75, 2, 3, true, false), undefined);
    assert.equal(decodedClipSeconds(2.5, 2, 3, true, false), 0.5);
    assert.equal(decodedClipSeconds(3.25, 2, 3, true, false), undefined);
    assert.equal(decodedClipSeconds(2.5, 2, 3, false, false), undefined);
  });
});

describe("DecodedClipVoice scheduling", () => {
  const originalFetch = globalThis.fetch;
  before(() => {
    globalThis.fetch = () => new Promise(() => {});
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  // An audio clock at `currentTime` recording the time each source plays
  // its clip's start at.
  function audioClock(currentTime: number) {
    const clipStarts: number[] = [];
    const context = {
      currentTime,
      createBufferSource: () => ({
        connect() {},
        disconnect() {},
        start: (when: number, offset: number) =>
          clipStarts.push(Math.round((when - offset) * 1e9) / 1e9),
        stop() {},
      }),
    };
    return { context, clipStarts };
  }

  // A loaded voice playing on `context`, sharing `clock`.
  function voiceOn(context: object, clock: DecodedVoiceClock) {
    const voice = new DecodedClipVoice(
      context as AudioContext,
      {} as AudioMixClip,
      "blob:clip",
      120,
      {} as AudioNode,
      true,
      clock,
    );
    (voice as unknown as { buffer: object }).buffer = {};
    return voice;
  }

  it("starts a clip on the audio clock where it starts, not at the next sync", () => {
    const { context, clipStarts } = audioClock(10);
    const voice = voiceOn(context, new DecodedVoiceClock());
    voice.sync(-0.25, 0.18, true, 2);
    assert.deepEqual(clipStarts, [10.25]);
    // The syncs after it starts leave it playing.
    context.currentTime = 10.4;
    voice.sync(0.15, 0.18, true, 2);
    assert.deepEqual(clipStarts, [10.25]);
  });

  it("starts back-to-back clips where the clock puts them, whatever the playhead read", () => {
    const clock = new DecodedVoiceClock();
    const { context, clipStarts } = audioClock(10);
    const first = voiceOn(context, clock);
    const second = voiceOn(context, clock);
    // The first clip, from 0 to 1 s, starts with playback.
    first.sync(0, 0.18, true, 0);
    // The playhead reads 20 ms late when the second, from 1 s, is handed
    // over; it still starts just as the first ends.
    context.currentTime = 10.5;
    second.sync(-0.52, 0.18, true, 1);
    assert.deepEqual(clipStarts, [10, 11]);
  });

  it("follows the playhead again once playback stops or scrubs", () => {
    const clock = new DecodedVoiceClock();
    const { context, clipStarts } = audioClock(10);
    const first = voiceOn(context, clock);
    const second = voiceOn(context, clock);
    first.sync(0, 0.18, true, 0);
    clock.holdWhile(false);
    context.currentTime = 10.5;
    second.sync(-0.52, 0.18, true, 1);
    assert.deepEqual(clipStarts, [10, 11.02]);
  });

  it("starts at once from where the playhead is, in steady playback a moment ahead", () => {
    const { context, clipStarts } = audioClock(10);
    const voice = voiceOn(context, new DecodedVoiceClock());
    voice.sync(0.25, 0.035, false, 2);
    voice.stop();
    voice.sync(0.25, 0.18, true, 2);
    assert.deepEqual(clipStarts, [9.75, 9.75]);
  });
});

describe("DecodedClipVoice retune", () => {
  function rePitched(semitones: number, amplitude = 1): AudioMixClip {
    return {
      id: "clip",
      mediaId: "media",
      startSeconds: 2,
      durationSeconds: 4,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 4,
      effects: [],
      amplitude,
      hasGain: true,
      busId: "bus",
      stages: [
        {
          id: "re-pitch",
          effectName: RE_PITCH_EFFECT_NAME,
          enabled: true,
          numbers: { [SEMITONES_KEY]: semitones },
          switches: {},
        },
      ],
    };
  }

  // A voice on an audio clock at `currentTime`, recording where in its
  // buffer each source starts and which clips' spans it renders, each
  // resolved when the test says.
  function retunableVoice(currentTime: number) {
    const offsets: number[] = [];
    const renders: { clip: AudioMixClip; resolve: () => void }[] = [];
    const context = {
      currentTime,
      sampleRate: 8000,
      createBuffer: () => ({ copyToChannel() {} }),
      createBufferSource: () => ({
        connect() {},
        disconnect() {},
        start: (when: number, offset: number) =>
          offsets.push(
            Math.round((offset - (when - context.currentTime)) * 1e9) / 1e9,
          ),
        stop() {},
      }),
    };
    class TestVoice extends DecodedClipVoice {
      protected override renderSpan(clip: AudioMixClip) {
        return new Promise<ClipSpan>((resolve) => {
          renders.push({ clip, resolve: () => resolve([new Float32Array(8)]) });
        });
      }
    }
    const voice = new TestVoice(
      context as unknown as AudioContext,
      rePitched(0),
      "blob:clip",
      120,
      {} as AudioNode,
    );
    return { voice, context, offsets, renders };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("maps a clip second to the one reading the same media under a new pitch", () => {
    // 1 s in at its own pitch reads the media 0.5 s in an octave up.
    assert.equal(reanchoredClipSeconds(rePitched(0), rePitched(12), 1), 0.5);
    assert.equal(reanchoredClipSeconds(rePitched(12), rePitched(-12), 1), 4);
  });

  it("renders its span again when its pitch changes, and plays on from the same media", async () => {
    const { voice, context, offsets, renders } = retunableVoice(10);
    renders[0].resolve();
    await settle();
    voice.sync(1, 0.18, true, 2);
    assert.deepEqual(offsets, [1]);
    context.currentTime = 11;
    voice.retune(rePitched(12), 120);
    assert.equal(renders.length, 2);
    // It plays the old span until the new one is ready.
    assert.deepEqual(offsets, [1]);
    renders[1].resolve();
    await settle();
    // 2 s into the clip it had read the media 2 s in, which an octave up
    // reads 1 s in.
    assert.deepEqual(offsets, [1, 1]);
    // Steady playback leaves it there rather than pulling it back to the
    // playhead.
    context.currentTime = 11.5;
    for (let sync = 0; sync < 4; sync++) {
      voice.sync(2.5, 0.18, true, 2);
    }
    assert.deepEqual(offsets, [1, 1]);
    // A scrub puts it back on the playhead.
    voice.sync(2.5, 0.035, false, 2);
    assert.deepEqual(offsets, [1, 1, 2.5]);
  });

  it("renders nothing again for a change that leaves its span alone", async () => {
    const { voice, renders } = retunableVoice(10);
    voice.retune(rePitched(0, 0.5), 120);
    assert.equal(renders.length, 1);
    // Each change of pitch renders again.
    voice.retune(rePitched(7), 120);
    voice.retune(rePitched(12), 120);
    assert.deepEqual(
      renders.map(({ clip }) => clip.stages[0].numbers[SEMITONES_KEY]),
      [0, 7, 12],
    );
  });
});
