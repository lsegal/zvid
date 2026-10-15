import { expect, test } from "vitest";
import { resolveSourceSpanSynths } from "./audio-mix/resolve.ts";
import { renderSynthClip } from "./audio-mix/synth.ts";
import { DRUM_RACK_EFFECT_NAME } from "./fx/effects/drum-rack/drum-rack.ts";
import { GRANULAR_EFFECT_NAME } from "./fx/effects/granular/granular.ts";
import { createEffect } from "./fx/stack/ops.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import { sourceClipEffectTrackId } from "./fx-stack.ts";
import type { MidiNote } from "./midi-clip.ts";
import { createSynthEffect } from "./midi-effects.ts";
import { DEFAULT_SESSION_ENCODING } from "./session-settings.ts";
import { SynthWaveformLoader } from "./synth-waveform-loader.ts";
import { peaksOfChannels } from "./waveform-peaks.ts";

// A MIDI clip's timeline waveform is its performance rendered as export
// renders it, with its peaks folded in a worker (see
// synth-waveform-loader.ts): it draws the same envelope export hears.

const EXPORT_SAMPLE_RATE = DEFAULT_SESSION_ENCODING.audioSampleRate;
const BPM = 120;
const stackId = sourceClipEffectTrackId("midi");

// Notes on the Drum Rack's kick, snare and closed hat pads, and across the
// keyboard for the pitched instruments.
const NOTES: MidiNote[] = [
  { pitch: 36, start: 0, length: 1, velocity: 127 },
  { pitch: 38, start: 1, length: 0.5, velocity: 90 },
  { pitch: 42, start: 2, length: 2, velocity: 60 },
  { pitch: 72, start: 4, length: 1, velocity: 110 },
];

function performance(instrument: SessionEffect) {
  const synths = resolveSourceSpanSynths({
    sourceTracks: [{ id: "keys" }],
    sourceSpans: [
      {
        id: "midi",
        sourceTrackId: "keys",
        startQ: 0,
        durationSeconds: 3,
        trimStartSeconds: 0,
        notes: NOTES,
      },
    ],
    effects: [instrument],
    bpm: BPM,
  });
  const resolved = synths.get("midi");
  if (!resolved) {
    throw new Error("The clip plays nothing");
  }
  return resolved;
}

for (const [name, instrument] of [
  ["Synth", createSynthEffect(stackId, undefined)],
  ["Granular", createEffect(stackId, GRANULAR_EFFECT_NAME)],
  ["Drum Rack", createEffect(stackId, DRUM_RACK_EFFECT_NAME)],
] as const) {
  test(`a ${name} clip's timeline waveform draws what export renders`, async () => {
    const { synth, mediaId } = performance(instrument);
    const request = new SynthWaveformLoader().request(mediaId, synth, BPM);
    const drawn = await request.peaks;
    request.release();
    const exported = await renderSynthClip(synth, BPM, EXPORT_SAMPLE_RATE);
    const heard = peaksOfChannels(exported.sampleRate, exported.channels);
    expect(drawn.status).toBe("ready");
    expect(heard.status).toBe("ready");
    if (drawn.status === "ready" && heard.status === "ready") {
      expect(drawn.peaks.durationSeconds).toBeCloseTo(3, 2);
      expect(Math.max(...heard.peaks.max)).toBeGreaterThan(0.01);
      expect(drawn.peaks.min).toEqual(heard.peaks.min);
      expect(drawn.peaks.max).toEqual(heard.peaks.max);
    }
  });
}
