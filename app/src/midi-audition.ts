// Auditions a note through a MIDI clip's Synth when the piano roll's note or key
// is clicked: one voice like the ones the mix renders (see
// audio-mix/synth.ts), played straight away on a context of its own,
// suspended again once nothing is sounding.
import { audioDiagnostics } from "./audio-mix/audio-diagnostics.ts";
import { noteFrequency, synthEnvelope } from "./audio-mix/synth.ts";
import type { SynthParams } from "./midi-clip.ts";
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

/** Plays `pitch` through `params` for a moment. */
export function auditionNote(pitch: number, params: SynthParams) {
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
