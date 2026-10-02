import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gainToAmplitude } from "../fx/effects/gain/gain.ts";
import { gainStageAt } from "../fx/effects/gain/processor.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import {
  CLIP,
  CLOCK,
  DELAY,
  ECHO,
  REVERSE,
  TEST_PROCESSORS,
  testStage,
} from "./chain-test-utils.ts";
import {
  audioMixTiming,
  type DecodedAudio,
  renderAudioMix,
  softLimit,
} from "./mix.ts";
import { type AudioStage, DEFAULT_TIME_SIGNATURE } from "./processor.ts";
import {
  type AudioMix,
  type AudioMixBus,
  type AudioMixClip,
  resolveAudioClips,
} from "./resolve.ts";

const SAMPLE_RATE = 8000;

function tone(frequency: number, peak: number, seconds = 2): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] =
      peak * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

// A source whose sample at second `s` is `s / 100`.
function ramp(seconds: number): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < data.length; index++) {
    data[index] = index / SAMPLE_RATE / 100;
  }
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

function constant(seconds: number, level = 0.5) {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE)).fill(level);
}

function clicks(atSeconds: number, seconds = 2): DecodedAudio {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  data[Math.round(atSeconds * SAMPLE_RATE)] = 0.5;
  return { sampleRate: SAMPLE_RATE, channels: [data] };
}

function clip(id: string, overrides: Partial<AudioMixClip> = {}): AudioMixClip {
  return {
    id,
    mediaId: id,
    startSeconds: 0,
    durationSeconds: 1,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 2,
    effects: [],
    amplitude: 1,
    hasGain: true,
    busId: "bus",
    stages: [gainStageAt(1)],
    ...overrides,
  };
}

function mix(
  clips: AudioMixClip[],
  options: { buses?: AudioMixBus[]; master?: AudioStage[] } = {},
): AudioMix {
  return {
    clips,
    buses: options.buses ?? [{ id: "bus", stages: [] }],
    master: options.master ?? [],
    masterAmplitude: 1,
    fromSourceTracks: true,
    bpm: 120,
    signature: DEFAULT_TIME_SIGNATURE,
  };
}

function render(
  audioMix: AudioMix,
  media: Record<string, DecodedAudio>,
  seconds = 2,
  startSeconds = 0,
) {
  const [output] = renderAudioMix(
    audioMix,
    new Map(Object.entries(media)),
    {
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      startSeconds,
      length: Math.round(seconds * SAMPLE_RATE),
    },
    TEST_PROCESSORS,
  );
  return output;
}

function largestDifference(a: Float32Array, b: Float32Array) {
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference = Math.max(difference, Math.abs(a[index] - b[index]));
  }
  return difference;
}

function peak(data: Float32Array, from = 0, to = data.length) {
  let max = 0;
  for (let index = from; index < to; index++) {
    max = Math.max(max, Math.abs(data[index]));
  }
  return max;
}

describe("audio effect chains in the mix", () => {
  const media = { a: tone(220, 0.3), b: tone(330, 0.3) };

  it("runs a track's effect once on its bus: the effect of the clips' sum", () => {
    const clipped = mix([clip("a"), clip("b")], {
      buses: [{ id: "bus", stages: [testStage(CLIP)] }],
    });
    const output = render(clipped, media, 1);
    const sum = new Float32Array(output.length);
    for (let index = 0; index < sum.length; index++) {
      sum[index] = softLimit(
        Math.tanh(
          3 * (media.a.channels[0][index] + media.b.channels[0][index]),
        ),
      );
    }
    assert.ok(largestDifference(output, sum) < 1e-6);

    // Clipping each clip on its own sounds different.
    const perClip = render(
      mix([
        clip("a", { stages: [gainStageAt(1), testStage(CLIP)] }),
        clip("b", { stages: [gainStageAt(1), testStage(CLIP)] }),
      ]),
      media,
      1,
    );
    assert.ok(largestDifference(perClip, sum) > 0.05);
  });

  it("runs the Global stack on the whole mix, before the limiter", () => {
    const output = render(
      mix([clip("a"), clip("b")], { master: [testStage(CLIP)] }),
      media,
      1,
    );
    const index = 123;
    const expected = softLimit(
      Math.tanh(3 * (media.a.channels[0][index] + media.b.channels[0][index])),
    );
    assert.ok(Math.abs(output[index] - expected) < 1e-6);
  });

  it("keeps a clip's tail ringing past its end, within the render", () => {
    const echoing = mix([
      clip("click", {
        durationSeconds: 0.5,
        stages: [gainStageAt(1), testStage(ECHO)],
      }),
    ]);
    const output = render(echoing, { click: clicks(0.4) }, 2);
    // The echo repeats every 50 ms at half the level, past the clip's end.
    assert.ok(Math.abs(output[0.6 * SAMPLE_RATE] - 0.5 ** 5) < 1e-6);
    assert.ok(Math.abs(output[0.4 * SAMPLE_RATE] - 0.5) < 1e-6);
  });

  it("renders a tail from before the export range into it", () => {
    const echoing = mix([
      clip("click", {
        durationSeconds: 0.5,
        stages: [gainStageAt(1), testStage(ECHO)],
      }),
    ]);
    const whole = render(echoing, { click: clicks(0.4) }, 2);
    const ranged = render(echoing, { click: clicks(0.4) }, 1, 0.55);
    const offset = 0.55 * SAMPLE_RATE;
    assert.ok(peak(ranged) > 0.01);
    assert.ok(largestDifference(ranged, whole.subarray(offset)) < 1e-6);
  });

  it("delays the faster paths so clips stay aligned, and the mix with the timeline", () => {
    const delayed = clip("late", {
      stages: [gainStageAt(1), testStage(DELAY, { Frames: 40 })],
    });
    const direct = clip("direct", { busId: "other" });
    const aligned = mix([delayed, direct], {
      buses: [
        { id: "bus", stages: [] },
        { id: "other", stages: [] },
      ],
      master: [testStage(DELAY, { Frames: 24 })],
    });
    const timing = audioMixTiming(aligned, SAMPLE_RATE, TEST_PROCESSORS);
    assert.equal(timing.clipDelayFrames.get("late"), 0);
    assert.equal(timing.clipDelayFrames.get("direct"), 40);
    assert.equal(timing.latencyFrames, 64);

    const output = render(aligned, { late: clicks(0.5), direct: clicks(0.5) });
    // Both clicks land together, at their summed level, where the media
    // puts them.
    assert.ok(Math.abs(output[0.5 * SAMPLE_RATE] - softLimit(1)) < 1e-6);
    assert.equal(peak(output, 0, 0.5 * SAMPLE_RATE), 0);
    assert.equal(peak(output, 0.5 * SAMPLE_RATE + 1), 0);
  });

  it("reads a clip's media through its source stages", () => {
    const reversed = mix([
      clip("ramp", {
        startSeconds: 0,
        durationSeconds: 1,
        stages: [gainStageAt(1), testStage(REVERSE)],
      }),
    ]);
    const output = render(reversed, { ramp: ramp(2) }, 1);
    // At 0.25 s it plays the media's 0.75 s.
    assert.ok(Math.abs(output[0.25 * SAMPLE_RATE] - 0.0075) < 1e-6);
    assert.ok(Math.abs(output[0.75 * SAMPLE_RATE] - 0.0025) < 1e-6);
  });

  it("gives processors the timeline time, so synced effects agree wherever a render starts", () => {
    const clocked = mix([clip("dc", { stages: [testStage(CLOCK)] })]);
    const steady = { dc: { sampleRate: SAMPLE_RATE, channels: [constant(2)] } };
    const whole = render(clocked, steady, 1);
    const ranged = render(clocked, steady, 0.5, 0.3);
    // A quarter at 120 BPM is half a second.
    assert.ok(Math.abs(whole[0.125 * SAMPLE_RATE] - 0.125) < 1e-6);
    assert.ok(
      largestDifference(ranged, whole.subarray(0.3 * SAMPLE_RATE)) < 1e-6,
    );
  });

  it("plays a session with only Gain at the levels it always has", () => {
    const resolved = resolveAudioClips({
      clips: [],
      lanes: [],
      sourceTracks: [{ id: "t1" }, { id: "t2" }],
      sourceSpans: [
        {
          id: "a",
          sourceTrackId: "t1",
          mediaId: "a",
          startQ: 0,
          durationSeconds: 2,
          trimStartSeconds: 0,
        },
        {
          id: "b",
          sourceTrackId: "t2",
          mediaId: "b",
          startQ: 0,
          durationSeconds: 2,
          trimStartSeconds: 0,
        },
      ],
      mediaById: new Map([
        ["a", { hasAudio: true }],
        ["b", { hasAudio: true }],
      ]),
      effects: [
        gainEffect(sourceTrackEffectTrackId("t1"), -6),
        gainEffect(sourceClipEffectTrackId("a"), 3),
        gainEffect(sourceClipEffectTrackId("b"), -10),
        gainEffect(GLOBAL_EFFECT_TRACK_ID, -2),
      ],
      bpm: 120,
    });
    const output = render(resolved, media, 2);
    const [a, b] = resolved.clips.map((resolvedClip) => resolvedClip.amplitude);
    for (const index of [0, 77, 4000, 15_999]) {
      const expected = softLimit(
        (a * media.a.channels[0][index] + b * media.b.channels[0][index]) *
          resolved.masterAmplitude,
      );
      assert.ok(Math.abs(output[index] - expected) < 1e-6, `${index}`);
    }
    assert.ok(Math.abs(a - gainToAmplitude(-3)) < 1e-9);
    assert.ok(Math.abs(resolved.masterAmplitude - gainToAmplitude(-2)) < 1e-9);
  });
});

let nextGainId = 0;
function gainEffect(trackId: string, db: number) {
  nextGainId += 1;
  return {
    id: `gain-${nextGainId}`,
    trackId,
    effectName: "Gain",
    parameters: [{ key: "Gain", value: String(db), numericValue: db }],
  };
}
