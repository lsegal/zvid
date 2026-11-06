// Auditions a note through a MIDI clip's instrument when the piano roll's
// note or key is clicked, or a Drum Rack's pad is pressed: one voice like
// the ones the mix renders (see audio-mix/synth.ts, audio-mix/granular.ts
// and audio-mix/drum-rack.ts), played straight away on a context of its
// own, suspended again once nothing is sounding.
import { audioDiagnostics } from "./audio-mix/audio-diagnostics.ts";
import { DRUM_VOICE_LEVEL, loadDrumSample } from "./audio-mix/drum-rack.ts";
import {
  GRANULAR_VOICE_LEVEL,
  granularGrains,
  mixGrains,
} from "./audio-mix/granular.ts";
import {
  bendRate,
  pressureLevel,
  timbreCutoff,
} from "./audio-mix/note-expression.ts";
import { noteFrequency, synthEnvelope } from "./audio-mix/synth.ts";
import { padForNote } from "./fx/effects/drum-rack/banks.ts";
import type {
  DrumRackParams,
  ExpressionSample,
  GranularParams,
  MidiInstrument,
  MidiNote,
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

/** An audition still sounding, which expression can go on changing. */
export type AuditionVoice = { update: (sample: ExpressionSample) => void };

// How quickly a live change of expression takes effect, so it never clicks.
const EXPRESSION_GLIDE_SECONDS = 0.01;

function glide(param: AudioParam, value: number, context: BaseAudioContext) {
  param.setTargetAtTime(value, context.currentTime, EXPRESSION_GLIDE_SECONDS);
}

function expressionGain(sample: ExpressionSample | undefined) {
  return sample?.pressure === undefined ? 1 : pressureLevel(sample.pressure);
}

/**
 * Plays `pitch` through `instrument` for a moment, starting from `expression`
 * if it has any. Returns the voice, unless the instrument has nothing to play.
 */
export function auditionNote(
  pitch: number,
  instrument: MidiInstrument,
  expression?: ExpressionSample,
): AuditionVoice | undefined {
  if (instrument.kind === "granular") {
    return auditionGranular(pitch, instrument.params, expression);
  }
  if (instrument.kind === "drums") {
    const pad = padForNote(pitch);
    if (pad === undefined) {
      return undefined;
    }
    const voice = drumPadVoice(expression);
    void auditionDrumPad(pad, instrument.params, voice);
    return voice;
  }
  return auditionSynth(pitch, instrument.params, expression);
}

function auditionSynth(
  pitch: number,
  params: SynthParams,
  expression: ExpressionSample | undefined,
): AuditionVoice {
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
  oscillator.detune.value = params.detune + (expression?.bend ?? 0) * 100;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value =
    expression?.timbre === undefined
      ? params.cutoff
      : timbreCutoff(params.cutoff, expression.timbre);
  filter.Q.value = params.resonance;
  const pressure = context.createGain();
  pressure.gain.value = expressionGain(expression);
  const gain = context.createGain();
  gain.gain.value = 0;
  const [first, ...rest] = envelope;
  gain.gain.setValueAtTime(first.level, first.seconds);
  for (const point of rest) {
    gain.gain.linearRampToValueAtTime(point.level, point.seconds);
  }
  oscillator
    .connect(filter)
    .connect(gain)
    .connect(pressure)
    .connect(context.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
    pressure.disconnect();
    auditionContext.release();
  };
  oscillator.start(start);
  oscillator.stop(envelope[envelope.length - 1].seconds);
  return {
    update(sample) {
      glide(oscillator.detune, params.detune + sample.bend * 100, context);
      glide(pressure.gain, expressionGain(sample), context);
      if (sample.timbre !== undefined) {
        glide(
          filter.frequency,
          timbreCutoff(params.cutoff, sample.timbre),
          context,
        );
      }
    },
  };
}

// A grain cloud held as long as a synth audition's note, at about its level.
function auditionGranular(
  pitch: number,
  params: GranularParams,
  expression: ExpressionSample | undefined,
): AuditionVoice {
  const context = auditionContext.acquire();
  const { sampleRate } = context;
  // At 60 bpm a quarter note lasts a second.
  const note: MidiNote = {
    pitch,
    start: 0,
    length: AUDITION_HOLD_SECONDS,
    velocity: Math.round((127 * AUDITION_LEVEL) / GRANULAR_VOICE_LEVEL),
    // The cloud is mixed before it plays, so its reads stay where they start;
    // the source's rate and gain below can still follow the bend and pressure.
    ...(expression?.timbre === undefined
      ? {}
      : { expression: { timbre: [{ at: 0, value: expression.timbre }] } }),
  };
  const grains = granularGrains([note], params, 60);
  const seconds = AUDITION_HOLD_SECONDS + params.release + params.grainSize;
  const length = Math.ceil(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  buffer.copyToChannel(mixGrains(grains, sampleRate, length), 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = bendRate(expression?.bend ?? 0);
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = params.resonance;
  const pressure = context.createGain();
  pressure.gain.value = expressionGain(expression);
  source.connect(filter).connect(pressure).connect(context.destination);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    pressure.disconnect();
    auditionContext.release();
  };
  source.start(context.currentTime + 0.01);
  return {
    update(sample) {
      glide(source.playbackRate, bendRate(sample.bend), context);
      glide(pressure.gain, expressionGain(sample), context);
    },
  };
}

// A drum pad's voice, which starts playing once its sample has loaded.
type DrumPadVoice = AuditionVoice & {
  sample: () => ExpressionSample | undefined;
  attach: (apply: (sample: ExpressionSample) => void) => void;
};

function drumPadVoice(initial: ExpressionSample | undefined): DrumPadVoice {
  let current = initial;
  let applied: ((sample: ExpressionSample) => void) | undefined;
  return {
    sample: () => current,
    attach(apply) {
      applied = apply;
    },
    update(sample) {
      current = sample;
      applied?.(sample);
    },
  };
}

/**
 * Plays `pad`'s sample through a Drum Rack playing `params`, at a
 * full-velocity hit's level, once it has loaded. Resolves to whether it
 * played: false for a silent pad or a sample that can't be read.
 */
export async function auditionDrumPad(
  pad: number,
  params: DrumRackParams,
  voice?: DrumPadVoice,
) {
  const url = params.samples[pad];
  if (!url) {
    return false;
  }
  const context = auditionContext.acquire();
  const sample = await loadDrumSample(url, context.sampleRate);
  if (!sample) {
    auditionContext.release();
    return false;
  }
  const buffer = context.createBuffer(1, sample.length, context.sampleRate);
  buffer.copyToChannel(sample, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const expression = voice?.sample();
  source.playbackRate.value = bendRate(expression?.bend ?? 0);
  const gain = context.createGain();
  gain.gain.value = DRUM_VOICE_LEVEL * expressionGain(expression);
  source.connect(gain).connect(context.destination);
  voice?.attach((sample) => {
    glide(source.playbackRate, bendRate(sample.bend), context);
    glide(gain.gain, DRUM_VOICE_LEVEL * expressionGain(sample), context);
  });
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    auditionContext.release();
  };
  source.start();
  return true;
}
