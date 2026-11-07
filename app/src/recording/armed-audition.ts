// Keys played on a MIDI device or the typing keyboard sound through every track
// armed for recording, whatever is selected (#1599), or with none armed, through
// the selected track (#1618). A track's instruments sit on its MIDI clips'
// stacks, so it plays the instrument of its MIDI clip at or last before the
// playhead, or else of its first. A track with none, or with its FX switched
// off, stays silent, as it would in the mix. Either way its notes sound through
// its clip's and track's effects, as the mix plays them, their LFOs on the audio
// clock rather than the paused playhead (see audio-mix/audition-chain.ts). A
// Drum Rack's pads sound through the stacks of the clip the rack is on.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { quartersToSeconds } from "../app/timeline-math.ts";
import type { ProjectState } from "../app/types.ts";
import {
  type AuditionStack,
  auditionChainSettings,
} from "../audio-mix/audition-chain.ts";
import { getEffectSourceSpanId } from "../fx/stack/clip-stacks.ts";
import { isLayerFxEnabled, sourceClipEffectTrackId } from "../fx-stack.ts";
import {
  type AuditionVoice,
  auditionDrumPad,
  auditionNote,
  updateAuditionChains,
} from "../midi-audition.ts";
import type {
  DrumRackParams,
  ExpressionSample,
  MidiInstrument,
} from "../midi-clip.ts";
import { auditionInstrumentOf } from "../midi-effects.ts";
import { signatureById } from "../time-signature.ts";
import { getArmedTrackIds } from "./record-arm.ts";

export type ArmedAuditionSession = Pick<
  ProjectState,
  "sourceTracks" | "sourceSpans" | "effects" | "bpm" | "signatureId"
>;

/** The tracks idle keys sound through: the armed ones, or else the selected. */
export function keyTrackIds(
  armedTrackIds: ReadonlySet<string>,
  selectedTrackId: string | undefined,
): ReadonlySet<string> {
  return armedTrackIds.size > 0 || selectedTrackId === undefined
    ? armedTrackIds
    : new Set([selectedTrackId]);
}

/**
 * What the tracks in `trackIds` play, leaving out the track that owns the clip
 * `exceptSpanId`: each one's instrument and the clip whose it is.
 */
function trackAuditions(
  trackIds: ReadonlySet<string>,
  { sourceTracks, sourceSpans, effects }: ArmedAuditionSession,
  playheadQ: number,
  exceptSpanId?: string,
) {
  const exceptTrackId = sourceSpans.find(
    (span) => span.id === exceptSpanId,
  )?.sourceTrackId;
  return sourceTracks.flatMap((track) => {
    if (
      !trackIds.has(track.id) ||
      track.id === exceptTrackId ||
      !isLayerFxEnabled(track)
    ) {
      return [];
    }
    const played = sourceSpans
      .filter((span) => span.sourceTrackId === track.id && span.notes)
      .flatMap((span) => {
        const stackId = sourceClipEffectTrackId(span.id);
        const instrument = auditionInstrumentOf(
          effects.filter((effect) => effect.trackId === stackId),
        );
        return instrument
          ? [{ spanId: span.id, startQ: span.startQ, instrument }]
          : [];
      })
      .sort((a, b) => a.startQ - b.startQ);
    const clip =
      played.findLast(({ startQ }) => startQ <= playheadQ) ?? played[0];
    return clip ? [clip] : [];
  });
}

/**
 * The instruments of the tracks in `trackIds`, leaving out the track that owns
 * the clip `exceptSpanId`.
 */
export function trackInstruments(
  trackIds: ReadonlySet<string>,
  session: ArmedAuditionSession,
  playheadQ: number,
  exceptSpanId?: string,
): MidiInstrument[] {
  return trackAuditions(trackIds, session, playheadQ, exceptSpanId).map(
    ({ instrument }) => instrument,
  );
}

/** What a note on the clip `spanId` plays through, at `playheadQ`. */
export function auditionStackOf(
  spanId: string,
  {
    sourceTracks,
    sourceSpans,
    effects,
    bpm,
    signatureId,
  }: ArmedAuditionSession,
  playheadQ: number,
): AuditionStack | undefined {
  const trackId = sourceSpans.find((span) => span.id === spanId)?.sourceTrackId;
  const track = sourceTracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    return undefined;
  }
  const { numerator, denominator } = signatureById(signatureId);
  return {
    trackId: track.id,
    spanId,
    settings: auditionChainSettings(
      effects,
      track.id,
      spanId,
      isLayerFxEnabled(track),
    ),
    tempo: { bpm, signature: { numerator, denominator } },
    playheadSeconds: quartersToSeconds(playheadQ, bpm),
  };
}

/** One voice for `voices`, which all follow it. */
export function combineVoices(
  voices: readonly (AuditionVoice | undefined)[],
): AuditionVoice | undefined {
  const sounding = voices.filter((voice) => voice !== undefined);
  if (sounding.length < 2) {
    return sounding[0];
  }
  return {
    update: (sample) => {
      for (const voice of sounding) {
        voice.update(sample);
      }
    },
    hold: () => {
      for (const voice of sounding) {
        voice.hold();
      }
    },
    release: () => {
      for (const voice of sounding) {
        voice.release();
      }
    },
  };
}

// What the armed tracks play right now, which the app keeps up to date.
let session: ArmedAuditionSession = {
  sourceTracks: [],
  sourceSpans: [],
  effects: [],
  bpm: 120,
  signatureId: "4/4",
};
let playheadQ = () => 0;

export function setArmedAuditionSource(
  nextSession: ArmedAuditionSession,
  nextPlayheadQ: () => number,
) {
  session = nextSession;
  playheadQ = nextPlayheadQ;
  updateAuditionChains((spanId) =>
    auditionStackOf(spanId, session, playheadQ()),
  );
}

/**
 * Plays `pitch` on every track in `trackIds` but the one owning `exceptSpanId`,
 * held until the voice is released, which a Drum Rack's one-shot pads don't wait
 * for.
 */
export function auditionTracks(
  trackIds: ReadonlySet<string>,
  pitch: number,
  expression: ExpressionSample | undefined,
  exceptSpanId?: string,
) {
  return combineVoices(
    trackAuditions(trackIds, session, playheadQ(), exceptSpanId).map(
      ({ spanId, instrument }) =>
        auditionNote(
          pitch,
          instrument,
          expression,
          true,
          auditionStackOf(spanId, session, playheadQ()),
        ),
    ),
  );
}

/** Plays `pitch` through the instrument and stack of the clip `spanId`. */
export function auditionClipNote(
  spanId: string,
  pitch: number,
  instrument: MidiInstrument,
  expression?: ExpressionSample,
  hold = false,
) {
  return auditionNote(
    pitch,
    instrument,
    expression,
    hold,
    auditionStackOf(spanId, session, playheadQ()),
  );
}

/**
 * Plays `pad` of the Drum Rack `effectId`, which plays `params`, through the
 * stack of the clip the rack is on, or dry without a source track owning it.
 */
export function auditionRackPad(
  effectId: string,
  pad: number,
  params: DrumRackParams,
) {
  const stackId = session.effects.find(({ id }) => id === effectId)?.trackId;
  const spanId = stackId && getEffectSourceSpanId(stackId);
  return auditionDrumPad(
    pad,
    params,
    undefined,
    spanId ? auditionStackOf(spanId, session, playheadQ()) : undefined,
  );
}

export function auditionArmedTracks(
  pitch: number,
  expression: ExpressionSample | undefined,
  exceptSpanId?: string,
) {
  return auditionTracks(getArmedTrackIds(), pitch, expression, exceptSpanId);
}

// How many open piano rolls take the keys, passing them on to the armed tracks.
let rollClaims = 0;
const rollListeners = new Set<() => void>();

function publishRollClaims(change: number) {
  rollClaims += change;
  for (const listener of rollListeners) {
    listener();
  }
}

/** Marks a piano roll as taking the keys until the returned function is called. */
export function claimRollKeys() {
  publishRollClaims(1);
  return () => publishRollClaims(-1);
}

function subscribeRollClaims(listener: () => void) {
  rollListeners.add(listener);
  return () => {
    rollListeners.delete(listener);
  };
}

export function useRollKeysClaimed() {
  return useSyncExternalStore(subscribeRollClaims, () => rollClaims > 0);
}

/**
 * Has a piano roll on the clip `spanId` take the keys while `takesKeys`.
 * Returns what adds the other armed tracks to the voice a key plays there, the
 * clip's own instrument speaking for its track.
 */
export function useArmedRollKeys(takesKeys: boolean, spanId: string) {
  useEffect(() => (takesKeys ? claimRollKeys() : undefined), [takesKeys]);
  return useCallback(
    (
      voice: AuditionVoice | undefined,
      pitch: number,
      expression: ExpressionSample | undefined,
    ) => combineVoices([voice, auditionArmedTracks(pitch, expression, spanId)]),
    [spanId],
  );
}
