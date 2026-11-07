// Auditions a note through a MIDI clip's instrument when the piano roll's
// note or key is clicked, or a Drum Rack's pad is pressed: one voice like
// the ones the mix renders (see audio-mix/synth.ts, audio-mix/granular.ts
// and audio-mix/drum-rack.ts), played straight away on a context of its
// own, suspended again once nothing is sounding. A key from a device playing
// MPE holds its voice until the key comes up, so its expression stays audible,
// and a voice already sounding starts holding once its device is shown to.
// Given its track's stack, a voice plays on through its effects, whose chain
// keeps the context running for its tail (see audio-mix/audition-chain.ts).
import { audioDiagnostics } from "./audio-mix/audio-diagnostics.ts";
import {
  AuditionChains,
  type AuditionStack,
  auditionTailSeconds,
} from "./audio-mix/audition-chain.ts";
import { DRUM_VOICE_LEVEL, loadDrumSample } from "./audio-mix/drum-rack.ts";
import {
  GRANULAR_VOICE_LEVEL,
  granularGrains,
  granularLoop,
  mixGrains,
} from "./audio-mix/granular.ts";
import {
  bendRate,
  pressureLevel,
  TIMBRE_CENTER,
  timbreCutoff,
} from "./audio-mix/note-expression.ts";
import {
  type EnvelopePoint,
  noteFrequency,
  synthEnvelope,
} from "./audio-mix/synth.ts";
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

const auditionChains = new AuditionChains((context) => {
  if (auditionContext.userCount) {
    void context.resume().catch(() => {});
  }
});

/** Where audition chains load the chain worklet from. */
export function setAuditionWorkletUrl(url: string) {
  auditionChains.workletUrl = url;
}

/** Has the chains of tracks auditioned so far follow an edit to their stacks. */
export function updateAuditionChains(
  resolve: (spanId: string) => AuditionStack | undefined,
) {
  auditionChains.update(resolve);
}

// Where a voice in `context` plays to, and what it calls when it has ended,
// which lets the context go once anything of it left in the chain has too.
function auditionOutput(context: AudioContext, stack?: AuditionStack) {
  if (!stack) {
    return {
      output: context.destination as AudioNode,
      ended: () => auditionContext.release(),
    };
  }
  return {
    output: auditionChains.input(context, stack),
    ended() {
      const tail = auditionTailSeconds(stack);
      if (tail > 0) {
        setTimeout(() => auditionContext.release(), tail * 1000);
      } else {
        auditionContext.release();
      }
    },
  };
}

/**
 * An audition still sounding, which expression can go on changing. `hold` keeps
 * a voice in its fixed time sounding until it is released, and does nothing on
 * one past that time or held already. `release` ends a held voice through its
 * instrument's release, once; a voice that isn't held ends by itself, and
 * ignores it.
 */
export type AuditionVoice = {
  update: (sample: ExpressionSample) => void;
  hold: () => void;
  release: () => void;
};

// How long a fixed grain cloud takes to give way to a looping one.
const CLOUD_CROSSFADE_SECONDS = 0.03;
// How far off a voice that has started holding moves the stop it had scheduled,
// which can only be replaced. Its release replaces it again.
const UNTIL_RELEASED_SECONDS = 1e8;
// How quickly a live change of expression takes effect, so it never clicks.
const EXPRESSION_GLIDE_SECONDS = 0.01;

function glide(param: AudioParam, value: number, context: BaseAudioContext) {
  param.setTargetAtTime(value, context.currentTime, EXPRESSION_GLIDE_SECONDS);
}

function expressionGain(sample: ExpressionSample | undefined) {
  return sample?.pressure === undefined ? 1 : pressureLevel(sample.pressure);
}

type EnvelopeParams = Pick<
  SynthParams,
  "attack" | "decay" | "sustain" | "release"
>;

function scheduleEnvelope(
  param: AudioParam,
  [first, ...rest]: readonly EnvelopePoint[],
) {
  param.setValueAtTime(first.level, first.seconds);
  for (const point of rest) {
    param.linearRampToValueAtTime(point.level, point.seconds);
  }
}

// Where an envelope held from `start` has reached at `seconds`.
function envelopeAt(
  params: EnvelopeParams,
  peak: number,
  start: number,
  seconds: number,
) {
  return synthEnvelope(params, peak, start, seconds).slice(-2)[0];
}

// Plays an envelope on `param` as far as its sustain, from where it has reached
// at `from` on, replacing what was scheduled, or rising from silence to there
// over `fadeIn`. Returns what releases it, from the level it has reached, which
// answers when it will be silent.
function holdEnvelope(
  param: AudioParam,
  params: EnvelopeParams,
  start: number,
  peak: number,
  from = start,
  fadeIn = 0,
) {
  const joined = from + fadeIn;
  const later = synthEnvelope(
    params,
    peak,
    start,
    Number.POSITIVE_INFINITY,
  ).filter(({ seconds }) => seconds > joined && Number.isFinite(seconds));
  const points = [envelopeAt(params, peak, start, joined), ...later];
  param.cancelScheduledValues(from);
  scheduleEnvelope(
    param,
    fadeIn ? [{ seconds: from, level: 0 }, ...points] : points,
  );
  return (now: number) => {
    const off = Math.max(now, joined);
    const [released, silent] = synthEnvelope(params, peak, start, off).slice(
      -2,
    );
    param.cancelScheduledValues(off);
    param.setValueAtTime(released.level, off);
    param.linearRampToValueAtTime(silent.level, silent.seconds);
    return silent.seconds;
  };
}

/**
 * Plays `pitch` through `instrument`, starting from `expression` if it has
 * any: for a moment, or with `hold` until the voice is released, which a Drum
 * Rack's one-shot pads don't wait for. Returns the voice, unless the
 * instrument has nothing to play. With `stack` it plays through that chain.
 */
export function auditionNote(
  pitch: number,
  instrument: MidiInstrument,
  expression?: ExpressionSample,
  hold = false,
  stack?: AuditionStack,
): AuditionVoice | undefined {
  if (instrument.kind === "granular") {
    return auditionGranular(pitch, instrument.params, expression, hold, stack);
  }
  if (instrument.kind === "drums") {
    const pad = padForNote(pitch);
    if (pad === undefined) {
      return undefined;
    }
    const voice = drumPadVoice(expression);
    void auditionDrumPad(pad, instrument.params, voice, stack);
    return voice;
  }
  return auditionSynth(pitch, instrument.params, expression, hold, stack);
}

function auditionSynth(
  pitch: number,
  params: SynthParams,
  expression: ExpressionSample | undefined,
  hold: boolean,
  stack: AuditionStack | undefined,
): AuditionVoice {
  const context = auditionContext.acquire();
  const { output, ended } = auditionOutput(context, stack);
  const start = context.currentTime + 0.01;
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
  oscillator
    .connect(filter)
    .connect(gain)
    .connect(pressure)
    .connect(output);
  oscillator.onended = () => {
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
    pressure.disconnect();
    ended();
  };
  oscillator.start(start);
  let release = () => {};
  const holdFrom = (from: number) => {
    const releaseGain = holdEnvelope(
      gain.gain,
      params,
      start,
      AUDITION_LEVEL,
      from,
    );
    release = () => oscillator.stop(releaseGain(context.currentTime));
  };
  let fixedUntil = 0;
  if (hold) {
    holdFrom(start);
  } else {
    fixedUntil = start + AUDITION_HOLD_SECONDS;
    const envelope = synthEnvelope(params, AUDITION_LEVEL, start, fixedUntil);
    scheduleEnvelope(gain.gain, envelope);
    oscillator.stop(envelope[envelope.length - 1].seconds);
  }
  return {
    hold() {
      const now = context.currentTime;
      if (now < fixedUntil) {
        fixedUntil = 0;
        oscillator.stop(now + UNTIL_RELEASED_SECONDS);
        holdFrom(Math.max(now, start));
      }
    },
    release: () => release(),
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

// A grain cloud held as long as a synth audition's note, at about its level,
// or looped under an envelope of its own until it is released. A fixed cloud
// that starts holding fades into a loop, since it can't go on past its end.
function auditionGranular(
  pitch: number,
  params: GranularParams,
  expression: ExpressionSample | undefined,
  hold: boolean,
  stack: AuditionStack | undefined,
): AuditionVoice {
  const context = auditionContext.acquire();
  const { output, ended } = auditionOutput(context, stack);
  const { sampleRate } = context;
  const start = context.currentTime + 0.01;
  // At 60 bpm a quarter note lasts a second.
  const note: MidiNote = {
    pitch,
    start: 0,
    length: AUDITION_HOLD_SECONDS,
    velocity: Math.round((127 * AUDITION_LEVEL) / GRANULAR_VOICE_LEVEL),
    // The cloud is mixed before it plays, so its reads stay where they start;
    // the source's rate and gain below can still follow the bend and pressure,
    // and the filter how far the slide has moved since.
    ...(expression?.timbre === undefined
      ? {}
      : { expression: { timbre: [{ at: 0, value: expression.timbre }] } }),
  };
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = params.resonance;
  const pressure = context.createGain();
  pressure.gain.value = expressionGain(expression);
  filter.connect(pressure).connect(output);
  let sounding = 0;
  const playCloud = (
    samples: Float32Array<ArrayBuffer>,
    from: number,
    rate: number,
    loop: boolean,
  ) => {
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    const envelope = context.createGain();
    source.connect(envelope).connect(filter);
    sounding++;
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      sounding--;
      if (!sounding) {
        filter.disconnect();
        pressure.disconnect();
        ended();
      }
    };
    source.start(from);
    return { source, envelope };
  };
  let release = () => {};
  const holdCloud = (
    samples: Float32Array<ArrayBuffer>,
    from: number,
    rate: number,
    fadeIn: number,
  ) => {
    const { source, envelope } = playCloud(samples, from, rate, true);
    const releaseCloud = holdEnvelope(
      envelope.gain,
      { attack: params.attack, decay: 0, sustain: 1, release: params.release },
      start,
      1,
      from,
      fadeIn,
    );
    release = () => source.stop(releaseCloud(context.currentTime));
    return source;
  };
  const rate = bendRate(expression?.bend ?? 0);
  const fixed = hold
    ? undefined
    : playCloud(
        mixGranularAudition(note, params, sampleRate),
        start,
        rate,
        false,
      );
  let source =
    fixed?.source ??
    holdCloud(granularLoop(note, params, sampleRate), start, rate, 0);
  let fixedUntil = fixed ? start + AUDITION_HOLD_SECONDS : 0;
  const pressedTimbre = expression?.timbre ?? TIMBRE_CENTER;
  return {
    hold() {
      if (!fixed || context.currentTime >= fixedUntil) {
        return;
      }
      fixedUntil = 0;
      const samples = granularLoop(note, params, sampleRate);
      const from = Math.max(context.currentTime + 0.01, start);
      const joined = from + CLOUD_CROSSFADE_SECONDS;
      fixed.envelope.gain.setValueAtTime(1, from);
      fixed.envelope.gain.linearRampToValueAtTime(0, joined);
      fixed.source.stop(joined);
      source = holdCloud(
        samples,
        from,
        source.playbackRate.value,
        CLOUD_CROSSFADE_SECONDS,
      );
    },
    release: () => release(),
    update(sample) {
      glide(source.playbackRate, bendRate(sample.bend), context);
      glide(pressure.gain, expressionGain(sample), context);
      if (sample.timbre !== undefined) {
        glide(
          filter.frequency,
          timbreCutoff(
            params.cutoff,
            TIMBRE_CENTER + sample.timbre - pressedTimbre,
          ),
          context,
        );
      }
    },
  };
}

function mixGranularAudition(
  note: MidiNote,
  params: GranularParams,
  sampleRate: number,
) {
  const grains = granularGrains([note], params, 60);
  const seconds = AUDITION_HOLD_SECONDS + params.release + params.grainSize;
  return mixGrains(grains, sampleRate, Math.ceil(seconds * sampleRate));
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
    hold() {},
    release() {},
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
  stack?: AuditionStack,
) {
  const url = params.samples[pad];
  if (!url) {
    return false;
  }
  const context = auditionContext.acquire();
  const { output, ended } = auditionOutput(context, stack);
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
  source.connect(gain).connect(output);
  voice?.attach((sample) => {
    glide(source.playbackRate, bendRate(sample.bend), context);
    glide(gain.gain, DRUM_VOICE_LEVEL * expressionGain(sample), context);
  });
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    ended();
  };
  source.start();
  return true;
}
