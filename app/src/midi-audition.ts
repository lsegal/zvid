// Auditions a note through a MIDI clip's instrument when the piano roll's
// note or key is clicked: one voice like the ones the mix renders (see
// audio-mix/synth.ts and audio-mix/granular.ts), played straight away on a
// context of its own, suspended again once nothing is sounding.
import { audioDiagnostics } from "./audio-mix/audio-diagnostics.ts";
import {
  GRANULAR_VOICE_LEVEL,
  granularGrains,
  mixGrains,
} from "./audio-mix/granular.ts";
import { noteFrequency, synthEnvelope } from "./audio-mix/synth.ts";
import type {
  GranularParams,
  MidiInstrument,
  SynthParams,
} from "./midi-clip.ts";
import { SharedAudioContext } from "./recording/shared-audio-context.ts";

// How long an audition holds its note before releasing it.
export const AUDITION_HOLD_SECONDS = 0.35;
// An audition's peak level, a little under a full-velocity note's in the mix.
const AUDITION_LEVEL = 0.2;

const auditionContext = new SharedAudioContext(() => {
  const context = new AudioContext();
  audioDiagnostics.addContext("note audition", context);
  return context;
});

/** Plays `pitch` through `instrument` for a moment. */
export function auditionNote(pitch: number, instrument: MidiInstrument) {
  if (instrument.kind === "granular") {
    auditionGranular(pitch, instrument.params);
  } else {
    auditionSynth(pitch, instrument.params);
  }
}

function auditionSynth(pitch: number, params: SynthParams) {
  const context = auditionContext.acquire();
  const start = context.currentTime + 0.01;
  const envelope = synthEnvelope(
    params,
    AUDITION_LEVEL,
    start,
    start + AUDITION_HOLD_SECONDS,
  );
  const oscillator = context.createOscillator();
  oscillator.type = params.wave;
  oscillator.frequency.value = noteFrequency(pitch, params.octave);
  oscillator.detune.value = params.detune;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = params.resonance;
  const gain = context.createGain();
  gain.gain.value = 0;
  const [first, ...rest] = envelope;
  gain.gain.setValueAtTime(first.level, first.seconds);
  for (const point of rest) {
    gain.gain.linearRampToValueAtTime(point.level, point.seconds);
  }
  oscillator.connect(filter).connect(gain).connect(context.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
    auditionContext.release();
  };
  oscillator.start(start);
  oscillator.stop(envelope[envelope.length - 1].seconds);
}

// A grain cloud held as long as a synth audition's note, at about its level.
function auditionGranular(pitch: number, params: GranularParams) {
  const context = auditionContext.acquire();
  const { sampleRate } = context;
  // At 60 bpm a quarter note lasts a second.
  const note = {
    pitch,
    start: 0,
    length: AUDITION_HOLD_SECONDS,
    velocity: Math.round((127 * AUDITION_LEVEL) / GRANULAR_VOICE_LEVEL),
  };
  const grains = granularGrains([note], params, 60);
  const seconds = AUDITION_HOLD_SECONDS + params.release + params.grainSize;
  const length = Math.ceil(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  buffer.copyToChannel(mixGrains(grains, sampleRate, length), 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = params.resonance;
  source.connect(filter).connect(context.destination);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    auditionContext.release();
  };
  source.start(context.currentTime + 0.01);
}
