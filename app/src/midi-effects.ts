// A source track's MIDI effects: the Arpeggiators and instruments (Synths,
// Granulars and Drum Racks) on its stack, which turn its MIDI clips' notes
// into the performance the mix plays (see audio-mix/resolve.ts) and which keys
// played into the track sound through (see recording/armed-audition.ts). Its
// enabled Arpeggiators transform the notes in stack order and its first enabled
// instrument, whichever kind it is, plays them; the instruments after it stay
// silent. Without an enabled instrument its clips make no sound. A clip with an
// instrument on its own stack plays that one instead (see clipMidiStack). A new
// MIDI clip's track gets a Synth and no Arpeggiator if it has no instrument.
// Sessions from before MIDI effects kept one synth and arpeggiator per source
// track, and sessions from before track MIDI effects kept them on each MIDI
// clip; opening either moves them to where they belong now.
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
import { drumRackParams } from "./fx/effects/drum-rack/drum-media.ts";
import {
  isDrumRackEffectName,
  readDrumRackEffect,
} from "./fx/effects/drum-rack/drum-rack.ts";
import {
  isGranularEffectName,
  readGranularEffect,
} from "./fx/effects/granular/granular.ts";
import {
  isSynthEffectName,
  readSynthEffect,
  SYNTH_EFFECT_NAME,
  SYNTH_NUMBER_KEYS,
  WAVE_KEY,
  waveOption,
} from "./fx/effects/synth/synth.ts";
import {
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./fx/stack/clip-stacks.ts";
import { createEffect, setEffectParameter } from "./fx/stack/ops.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import { isMidiEffectName } from "./fx-registry.ts";
import {
  type MidiInstrument,
  readSynthParams,
  type SynthParams,
} from "./midi-clip.ts";
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

/** What a MIDI clip plays: its notes through `generators`, then `instrument`. */
export type MidiChain = {
  generators: NoteGenerator[];
  instrument: MidiInstrument;
};

function isInstrumentEffectName(effectName: string) {
  return (
    isSynthEffectName(effectName) ||
    isGranularEffectName(effectName) ||
    isDrumRackEffectName(effectName)
  );
}

// The instrument a Synth, Granular or Drum Rack `effect` plays.
function readInstrument(effect: MidiChainEffect): MidiInstrument {
  if (isGranularEffectName(effect.effectName)) {
    return { kind: "granular", params: readGranularEffect(effect.parameters) };
  }
  if (isDrumRackEffectName(effect.effectName)) {
    return {
      kind: "drums",
      params: drumRackParams(readDrumRackEffect(effect.parameters)),
    };
  }
  return { kind: "synth", params: readSynthEffect(effect.parameters) };
}

/**
 * The MIDI effects a MIDI clip plays through: its track's stack, unless the
 * clip has an instrument of its own, which then plays it with the clip's own
 * MIDI effects alone. An Arpeggiator alone on the clip's stack runs ahead of
 * the track's chain.
 */
export function clipMidiStack<Effect extends MidiChainEffect>(
  clipStack: readonly Effect[],
  trackStack: readonly Effect[],
): readonly Effect[] {
  return clipStack.some((effect) => isInstrumentEffectName(effect.effectName))
    ? clipStack
    : [...clipStack, ...trackStack];
}

/**
 * The MIDI chain of the MIDI effects in `stack`: its Arpeggiators in stack
 * order, bypassed ones passing notes through, and its first enabled
 * instrument, a Synth, a Granular or a Drum Rack. Undefined without an enabled
 * instrument, when the clip makes no sound.
 */
export function midiChainOf(
  stack: readonly MidiChainEffect[],
): MidiChain | undefined {
  const instrument = stack.find(
    (effect) =>
      effect.enabled !== false && isInstrumentEffectName(effect.effectName),
  );
  if (!instrument) {
    return undefined;
  }
  return {
    generators: stack
      .filter((effect) => isArpeggiatorEffectName(effect.effectName))
      .map((effect) =>
        readArpeggiatorEffect(effect.parameters, effect.enabled !== false),
      ),
    instrument: readInstrument(instrument),
  };
}

/**
 * The instrument `stack` auditions notes with, in the piano roll and for keys
 * played into a track: its first enabled instrument, else its first
 * instrument, else undefined.
 */
export function auditionInstrumentOf(
  stack: readonly MidiChainEffect[],
): MidiInstrument | undefined {
  const instruments = stack.filter((effect) =>
    isInstrumentEffectName(effect.effectName),
  );
  const instrument =
    instruments.find((effect) => effect.enabled !== false) ?? instruments[0];
  return instrument ? readInstrument(instrument) : undefined;
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

function hasInstrument(effects: readonly SessionEffect[], stackId: string) {
  return effects.some(
    (effect) =>
      effect.trackId === stackId && isInstrumentEffectName(effect.effectName),
  );
}

/**
 * `effects` with a default Synth leading the stack of source track
 * `sourceTrackId`, for a new MIDI clip there, unless it has an instrument.
 */
export function addDefaultSynth(
  effects: SessionEffect[],
  sourceTrackId: string,
  id?: string,
) {
  const trackId = sourceTrackEffectTrackId(sourceTrackId);
  return hasInstrument(effects, trackId)
    ? effects
    : prependToStack(effects, trackId, [
        createSynthEffect(trackId, undefined, id),
      ]);
}

/**
 * `effects` once a MIDI clip came to source track `toTrackId` from
 * `fromTrackId`: a track with no instrument takes a copy of the other's MIDI
 * effects, so the clip sounds as it did. Returns `effects` itself otherwise.
 */
export function carryTrackInstrument(
  effects: SessionEffect[],
  fromTrackId: string,
  toTrackId: string,
  createId: () => string = () => crypto.randomUUID(),
) {
  const from = sourceTrackEffectTrackId(fromTrackId);
  const to = sourceTrackEffectTrackId(toTrackId);
  if (from === to || hasInstrument(effects, to)) {
    return effects;
  }
  const copies = effects
    .filter(
      (effect) =>
        effect.trackId === from && isMidiEffectName(effect.effectName),
    )
    .map((effect) => ({
      ...effect,
      id: createId(),
      trackId: to,
      parameters: effect.parameters.map((parameter) => ({ ...parameter })),
    }));
  return copies.length ? prependToStack(effects, to, copies) : effects;
}

/** `effects` once MIDI clips moved between source tracks, from `before` to `after`. */
export function carryMovedClipInstruments(
  effects: SessionEffect[],
  before: readonly MidiSpan[],
  after: readonly MidiSpan[],
) {
  const trackBefore = new Map(
    before.map((span) => [span.id, span.sourceTrackId]),
  );
  return after.reduce((next, span) => {
    const fromTrackId = trackBefore.get(span.id);
    return span.notes && fromTrackId !== undefined
      ? carryTrackInstrument(next, fromTrackId, span.sourceTrackId)
      : next;
  }, effects);
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

// What makes two MIDI effects play alike, whatever stack they sit on.
function midiEffectSound({ effectName, enabled, parameters }: SessionEffect) {
  return JSON.stringify([effectName, enabled !== false, parameters]);
}

/**
 * Sessions saved before tracks had MIDI effects kept them on MIDI clips'
 * stacks. Opening one moves those of each track's first clip with an instrument
 * onto the track, ahead of its stack, and drops the same effects from the
 * track's other clips, so their sound follows the track from then on. A clip
 * playing something else keeps its own, and plays as it did. A session saved
 * since carries `midiTrackEffects` and opens with its stacks as saved. Returns
 * `effects` itself when nothing moves.
 */
export function migrateMidiTrackEffects(
  effects: SessionEffect[],
  sourceSpans: readonly (MidiSpan & { startQ: number })[],
  midiTrackEffects: boolean | undefined,
) {
  if (midiTrackEffects === true) {
    return effects;
  }
  const midiStackOf = (stackId: string) =>
    effects.filter(
      (effect) =>
        effect.trackId === stackId && isMidiEffectName(effect.effectName),
    );
  const soundOf = (stack: readonly SessionEffect[]) =>
    stack.map(midiEffectSound).join();
  const spans = sourceSpans
    .filter((span) => Array.isArray(span.notes))
    .sort((a, b) => a.startQ - b.startQ);
  let next = effects;
  for (const trackId of new Set(spans.map((span) => span.sourceTrackId))) {
    const stacks = spans
      .filter((span) => span.sourceTrackId === trackId)
      .map((span) => midiStackOf(sourceClipEffectTrackId(span.id)));
    const moved = stacks.find((stack) =>
      stack.some((effect) => isInstrumentEffectName(effect.effectName)),
    );
    if (!moved) {
      continue;
    }
    const dropped = new Set(
      stacks.filter((stack) => soundOf(stack) === soundOf(moved)).flat(),
    );
    const stackId = sourceTrackEffectTrackId(trackId);
    next = prependToStack(
      next.filter((effect) => !dropped.has(effect)),
      stackId,
      moved.map((effect) => ({ ...effect, trackId: stackId })),
    );
  }
  return next;
}
