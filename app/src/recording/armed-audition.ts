// Keys played on a MIDI device or the typing keyboard sound through every track
// armed for recording, whatever is selected (#1599), or with none armed, through
// the selected track (#1618). A track plays the instrument on its own stack. A
// track with none, or with its FX switched off, stays silent, as it would in
// the mix.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ProjectState } from "../app/types.ts";
import { isLayerFxEnabled, sourceTrackEffectTrackId } from "../fx-stack.ts";
import { type AuditionVoice, auditionNote } from "../midi-audition.ts";
import type { ExpressionSample, MidiInstrument } from "../midi-clip.ts";
import { auditionInstrumentOf } from "../midi-effects.ts";
import { getArmedTrackIds } from "./record-arm.ts";

export type ArmedAuditionSession = Pick<
  ProjectState,
  "sourceTracks" | "sourceSpans" | "effects"
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
 * the clip `exceptSpanId`.
 */
export function trackInstruments(
  trackIds: ReadonlySet<string>,
  { sourceTracks, sourceSpans, effects }: ArmedAuditionSession,
  exceptSpanId?: string,
): MidiInstrument[] {
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
    return instrument ? [instrument] : [];
  });
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
};

export function setArmedAuditionSource(nextSession: ArmedAuditionSession) {
  session = nextSession;
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
    trackInstruments(trackIds, session, exceptSpanId).map((instrument) =>
      auditionNote(pitch, instrument, expression, true),
    ),
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
