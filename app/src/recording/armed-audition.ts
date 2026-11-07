// Keys played on a MIDI device or the typing keyboard sound through every track
// armed for recording, whatever is selected (#1599), or with none armed, through
// the selected track (#1618). A track plays the instrument on its own stack. A
// track with none, or with its FX switched off, stays silent, as it would in
// the mix. Its notes sound through its effects, as the mix plays them, their
// LFOs on the audio clock rather than the paused playhead (see
// audio-mix/audition-chain.ts).
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { quartersToSeconds } from "../app/timeline-math.ts";
import type { ProjectState } from "../app/types.ts";
import {
  type AuditionStack,
  auditionChainSettings,
} from "../audio-mix/audition-chain.ts";
import { isLayerFxEnabled, sourceTrackEffectTrackId } from "../fx-stack.ts";
import {
  type AuditionVoice,
  auditionNote,
  updateAuditionChains,
} from "../midi-audition.ts";
import type { ExpressionSample, MidiInstrument } from "../midi-clip.ts";
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
 * The instruments of the tracks in `trackIds`, leaving out the track that owns
 * the clip `exceptSpanId`, by track id.
 */
function trackAuditions(
  trackIds: ReadonlySet<string>,
  { sourceTracks, sourceSpans, effects }: ArmedAuditionSession,
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
    const stackId = sourceTrackEffectTrackId(track.id);
    const instrument = auditionInstrumentOf(
      effects.filter((effect) => effect.trackId === stackId),
    );
    return instrument ? [{ trackId: track.id, instrument }] : [];
  });
}

/**
 * The instruments of the tracks in `trackIds`, leaving out the track that owns
 * the clip `exceptSpanId`.
 */
export function trackInstruments(
  trackIds: ReadonlySet<string>,
  session: ArmedAuditionSession,
  exceptSpanId?: string,
): MidiInstrument[] {
  return trackAuditions(trackIds, session, exceptSpanId).map(
    ({ instrument }) => instrument,
  );
}

/**
 * What a note on the track `trackId` plays through, at `playheadQ`: the clip
 * `spanId`'s stack as well for a note on that clip, and otherwise its own.
 */
export function auditionStackOf(
  trackId: string,
  spanId: string | undefined,
  { sourceTracks, effects, bpm, signatureId }: ArmedAuditionSession,
  playheadQ: number,
): AuditionStack | undefined {
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
  updateAuditionChains((trackId, spanId) =>
    auditionStackOf(trackId, spanId, session, playheadQ()),
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
    trackAuditions(trackIds, session, exceptSpanId).map(
      ({ trackId, instrument }) =>
        auditionNote(
          pitch,
          instrument,
          expression,
          true,
          auditionStackOf(trackId, undefined, session, playheadQ()),
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
  const trackId = session.sourceSpans.find(
    (span) => span.id === spanId,
  )?.sourceTrackId;
  return auditionNote(
    pitch,
    instrument,
    expression,
    hold,
    trackId === undefined
      ? undefined
      : auditionStackOf(trackId, spanId, session, playheadQ()),
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
