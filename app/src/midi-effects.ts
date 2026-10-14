// A MIDI clip's MIDI effects: the Arpeggiators and Synth on its own stack,
// which turn its notes into the performance the mix plays (see
// audio-mix/resolve.ts). Its enabled Arpeggiators transform its notes in
// stack order and its first enabled Synth plays them; without an enabled
// Synth it makes no sound. A new MIDI clip gets a Synth and no
// Arpeggiator. Sessions from before MIDI effects kept one synth and
// arpeggiator per source track; opening one moves them onto each of the
// track's MIDI clips.
import {
  ARPEGGIATOR_EFFECT_NAME,
  isArpeggiatorEffectName,
  OCTAVES_KEY,
  PATTERN_KEY,
  patternOption,
  RATE_KEY,
  rateOption,
  readArpeggiatorEffect,
} from "./fx/effects/arpeggiator/arpeggiator.ts";
import {
  isSynthEffectName,
  readSynthEffect,
  SYNTH_EFFECT_NAME,
  SYNTH_NUMBER_KEYS,
  WAVE_KEY,
  waveOption,
} from "./fx/effects/synth/synth.ts";
import { sourceClipEffectTrackId } from "./fx/stack/clip-stacks.ts";
import { createEffect, setEffectParameter } from "./fx/stack/ops.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import { isMidiEffectName } from "./fx-registry.ts";
import { readSynthParams, type SynthParams } from "./midi-clip.ts";
import {
  type Arpeggiator,
  type NoteGenerator,
  readNoteGenerators,
} from "./note-generators.ts";

type MidiChainEffect = {
  effectName: string;
  enabled?: boolean;
  parameters: readonly { key: string; value: string; numericValue?: number }[];
};

/** What a MIDI clip plays: its notes through `generators`, then `synth`. */
export type MidiChain = {
  generators: NoteGenerator[];
  synth: SynthParams;
};

/**
 * The MIDI chain of a MIDI clip's own `stack`: its Arpeggiators in stack
 * order, bypassed ones passing notes through, and its first enabled Synth.
 * Undefined without an enabled Synth, when the clip makes no sound.
 */
export function midiChainOf(
  stack: readonly MidiChainEffect[],
): MidiChain | undefined {
  const synth = stack.find(
    (effect) =>
      effect.enabled !== false && isSynthEffectName(effect.effectName),
  );
  if (!synth) {
    return undefined;
  }
  return {
    generators: stack
      .filter((effect) => isArpeggiatorEffectName(effect.effectName))
      .map((effect) =>
        readArpeggiatorEffect(effect.parameters, effect.enabled !== false),
      ),
    synth: readSynthEffect(synth.parameters),
  };
}

/**
 * The synth a MIDI clip's own `stack` auditions its notes with in the
 * piano roll: its first enabled Synth's, else its first Synth's, else
 * undefined.
 */
export function auditionSynthOf(
  stack: readonly MidiChainEffect[],
): SynthParams | undefined {
  const synths = stack.filter((effect) => isSynthEffectName(effect.effectName));
  const synth = synths.find((effect) => effect.enabled !== false) ?? synths[0];
  return synth ? readSynthEffect(synth.parameters) : undefined;
}

function withParameters(
  effect: SessionEffect,
  values: ReadonlyArray<readonly [string, number | string]>,
) {
  return values.reduce(
    (effects, [key, value]) =>
      setEffectParameter(effects, effect.id, key, value),
    [effect],
  )[0];
}

/** A Synth effect on `trackId`'s stack playing `params`. */
export function createSynthEffect(
  trackId: string,
  params: SynthParams | undefined,
  id?: string,
): SessionEffect {
  const effect = createEffect(trackId, SYNTH_EFFECT_NAME, id);
  if (!params) {
    return effect;
  }
  return withParameters(effect, [
    [WAVE_KEY, waveOption(params.wave)],
    ...Object.entries(SYNTH_NUMBER_KEYS).map(
      ([field, key]) =>
        [key, params[field as keyof typeof SYNTH_NUMBER_KEYS]] as const,
    ),
  ]);
}

/** An Arpeggiator effect on `trackId`'s stack playing `arp`. */
export function createArpeggiatorEffect(
  trackId: string,
  arp: Arpeggiator,
  id?: string,
): SessionEffect {
  return {
    ...withParameters(createEffect(trackId, ARPEGGIATOR_EFFECT_NAME, id), [
      [RATE_KEY, rateOption(arp.rate)],
      [PATTERN_KEY, patternOption(arp.pattern)],
      [OCTAVES_KEY, arp.octaves],
    ]),
    enabled: arp.enabled,
  };
}

// `effects` with `added` inserted at the start of the `trackId` stack.
function prependToStack(
  effects: SessionEffect[],
  trackId: string,
  added: readonly SessionEffect[],
) {
  const index = effects.findIndex((effect) => effect.trackId === trackId);
  const at = index < 0 ? effects.length : index;
  return [...effects.slice(0, at), ...added, ...effects.slice(at)];
}

/** `effects` with a default Synth leading the new MIDI clip `spanId`'s stack. */
export function addDefaultSynth(
  effects: SessionEffect[],
  spanId: string,
  id?: string,
) {
  const trackId = sourceClipEffectTrackId(spanId);
  return prependToStack(effects, trackId, [
    createSynthEffect(trackId, undefined, id),
  ]);
}

// A source track as an older session or workspace saved it, with the synth
// and note generators its MIDI clips played through.
type LegacyMidiTrack = {
  id: string;
  synth?: unknown;
  noteGenerators?: unknown;
};

type MidiSpan = { id: string; sourceTrackId: string; notes?: unknown };

/**
 * Sessions saved before MIDI effects kept a synth (the default one when
 * unset) and an arpeggiator on each source track. Opening one leads each
 * of its MIDI clips' stacks with that track's Arpeggiator and Synth, so it
 * plays as it did, unless the stack already has a MIDI effect. A session
 * saved since carries `midiClipEffects` and opens with its stacks as
 * saved, so a Synth the user removed stays removed. Returns `effects`
 * itself when nothing is added.
 */
export function migrateMidiClipEffects(
  effects: SessionEffect[],
  sourceTracks: readonly LegacyMidiTrack[],
  sourceSpans: readonly MidiSpan[],
  midiClipEffects: boolean | undefined,
  createId: () => string = () => crypto.randomUUID(),
) {
  if (midiClipEffects === true) {
    return effects;
  }
  const withMidi = new Set(
    effects
      .filter((effect) => isMidiEffectName(effect.effectName))
      .map((effect) => effect.trackId),
  );
  let next = effects;
  for (const span of sourceSpans) {
    const trackId = sourceClipEffectTrackId(span.id);
    if (!Array.isArray(span.notes) || withMidi.has(trackId)) {
      continue;
    }
    const track = sourceTracks.find(
      (candidate) => candidate.id === span.sourceTrackId,
    );
    const generators = readNoteGenerators(track?.noteGenerators) ?? [];
    next = prependToStack(next, trackId, [
      ...generators.map((arp) =>
        createArpeggiatorEffect(trackId, arp, createId()),
      ),
      createSynthEffect(trackId, readSynthParams(track?.synth), createId()),
    ]);
  }
  return next;
}
