/// <reference lib="dom" />
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { gainStageAt } from "../fx/effects/gain/processor.ts";
import { REVERSE_EFFECT_NAME } from "../fx/effects/reverse/reverse.ts";
import {
  ClipAudioCache,
  InlineClipSpanBackend,
  WorkerClipSpanBackend,
} from "./clip-audio-cache.ts";
import { renderClipSpan } from "./clip-span.ts";
import type { DecodedAudio } from "./mix.ts";
import { DecodedClipVoice } from "./preview-buffer-voice.ts";
import type { AudioMixClip } from "./resolve.ts";

const SAMPLE_RATE = 8000;
const BPM = 120;

function ramp(seconds: number): DecodedAudio {
  const left = new Float32Array(seconds * SAMPLE_RATE);
  const right = new Float32Array(seconds * SAMPLE_RATE);
  for (let index = 0; index < left.length; index++) {
    left[index] = index / left.length;
    right[index] = -index / left.length;
  }
  return { sampleRate: SAMPLE_RATE, channels: [left, right] };
}

function reversedClip(overrides: Partial<AudioMixClip> = {}): AudioMixClip {
  return {
    id: "clip",
    mediaId: "media",
    startSeconds: 2,
    durationSeconds: 1,
    sourceOffsetSeconds: -1.5,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 2,
    effects: [],
    amplitude: 1,
    hasGain: true,
    busId: "bus",
    stages: [
      gainStageAt(1),
      {
        id: "reverse",
        effectName: REVERSE_EFFECT_NAME,
        enabled: true,
        numbers: {},
        switches: {},
      },
    ],
    ...overrides,
  };
}

// A decoder that counts its calls, handing out fresh copies of `media`.
function countingDecoder(media: DecodedAudio) {
  const decoder = {
    calls: 0,
    decode: async () => {
      decoder.calls += 1;
      return {
        sampleRate: media.sampleRate,
        channels: media.channels.map((channel) => channel.slice()),
      };
    },
  };
  return decoder;
}

describe("ClipAudioCache", () => {
  const source = (clip: AudioMixClip) => ({
    clip,
    url: "blob:media",
    bpm: BPM,
    sampleRate: SAMPLE_RATE,
  });

  it("renders the span the preview always rendered", async () => {
    const media = ramp(2);
    const clip = reversedClip();
    const cache = new ClipAudioCache(new InlineClipSpanBackend());
    const span = await cache.span(source(clip), countingDecoder(media).decode);
    const expected = renderClipSpan(clip, media, BPM, SAMPLE_RATE, 2);
    assert.equal(span.length, 2);
    assert.deepEqual(span, expected);
    // Reversed: the clip's start plays late in its window.
    assert.ok(span[0][100] > span[0][span[0].length - 100]);
  });

  it("decodes a media once for every voice that plays it", async () => {
    const decoder = countingDecoder(ramp(2));
    const cache = new ClipAudioCache(new InlineClipSpanBackend());
    const clip = reversedClip();
    const [first, second] = await Promise.all([
      cache.span(source(clip), decoder.decode),
      cache.span(source(clip), decoder.decode),
    ]);
    // A seek or loop makes the voice again.
    const again = await cache.span(source(clip), decoder.decode);
    // Another clip of the same media renders without decoding it again.
    const moved = await cache.span(
      source(reversedClip({ id: "other" })),
      decoder.decode,
    );
    assert.equal(decoder.calls, 1);
    assert.equal(first, second);
    assert.equal(again, first);
    assert.deepEqual(moved, first);
  });

  it("decodes again once its media is evicted", async () => {
    const decoder = countingDecoder(ramp(2));
    const other = countingDecoder(ramp(1));
    // Room for only one decoded media at a time, and no spans.
    const cache = new ClipAudioCache(
      new InlineClipSpanBackend(2 * 2 * SAMPLE_RATE * 4),
      0,
    );
    await cache.span(source(reversedClip()), decoder.decode);
    await cache.span(
      { ...source(reversedClip({ mediaId: "b" })), url: "blob:b" },
      other.decode,
    );
    await cache.span(source(reversedClip()), decoder.decode);
    assert.equal(decoder.calls, 2);
  });

  it("tries a failed decode again on the next voice", async () => {
    const cache = new ClipAudioCache(new InlineClipSpanBackend());
    const decoder = countingDecoder(ramp(2));
    await assert.rejects(
      cache.span(source(reversedClip()), async () => {
        throw new Error("offline");
      }),
    );
    await cache.span(source(reversedClip()), decoder.decode);
    assert.equal(decoder.calls, 1);
  });

  it("renders on the main thread where workers are unavailable", async () => {
    const cache = new ClipAudioCache(new WorkerClipSpanBackend());
    const media = ramp(2);
    const span = await cache.span(
      source(reversedClip()),
      countingDecoder(media).decode,
    );
    assert.deepEqual(
      span,
      renderClipSpan(reversedClip(), media, BPM, SAMPLE_RATE, 2),
    );
  });
});

describe("DecodedClipVoice", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches and decodes a media once across voices", async () => {
    const media = ramp(2);
    let fetches = 0;
    let decodes = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(new ArrayBuffer(8));
    }) as typeof fetch;
    const buffers: Float32Array[][] = [];
    const context = {
      sampleRate: SAMPLE_RATE,
      decodeAudioData: async () => {
        decodes += 1;
        return {
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 2,
          getChannelData: (index: number) => media.channels[index],
        };
      },
      createBuffer: (channels: number, length: number) => {
        const data = Array.from(
          { length: channels },
          () => new Float32Array(length),
        );
        buffers.push(data);
        return {
          copyToChannel: (source: Float32Array, channel: number) => {
            data[channel].set(source);
          },
        };
      },
    } as unknown as AudioContext;
    const output = {} as AudioNode;
    const clip = reversedClip();
    const url = "blob:voice-media";
    const first = new DecodedClipVoice(context, clip, url, BPM, output);
    const second = new DecodedClipVoice(context, clip, url, BPM, output);
    const settle = async () => {
      for (let turn = 0; turn < 20 && buffers.length < 2; turn++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    await settle();
    first.dispose();
    second.dispose();
    const third = new DecodedClipVoice(context, clip, url, BPM, output);
    const settled = buffers.length;
    for (let turn = 0; turn < 20 && buffers.length === settled; turn++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    third.dispose();
    assert.equal(fetches, 1);
    assert.equal(decodes, 1);
    assert.equal(buffers.length, 3);
    const expected = renderClipSpan(clip, media, BPM, SAMPLE_RATE, 2);
    assert.deepEqual(buffers[2], expected);
  });
});
