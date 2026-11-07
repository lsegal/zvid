// Keys played on a MIDI device or the typing keyboard sound through every track
// armed for recording, whatever is selected (#1599). A track's instruments sit
// on its MIDI clips' stacks, so it plays the instrument of its MIDI clip at or
// last before the playhead, or else of its first. A track with none, or with
// its FX switched off, stays silent, as it would in the mix.
import { useSyncExternalStore } from "react";
import type { ProjectState } from "../app/types.ts";
import { isLayerFxEnabled, sourceClipEffectTrackId } from "../fx-stack.ts";
import { type AuditionVoice, auditionNote } from "../midi-audition.ts";
import type { ExpressionSample, MidiInstrument } from "../midi-clip.ts";
import { auditionInstrumentOf } from "../midi-effects.ts";
import { getArmedTrackIds } from "./record-arm.ts";

export type ArmedAuditionSession = Pick<
  ProjectState,
  "sourceTracks" | "sourceSpans" | "effects"
>;

/**
 * The instruments of the tracks in `armedTrackIds`, leaving out the track that
 * owns the clip `exceptSpanId`.
 */
export function armedInstruments(
  armedTrackIds: ReadonlySet<string>,
  { sourceTracks, sourceSpans, effects }: ArmedAuditionSession,
  playheadQ: number,
  exceptSpanId?: string,
): MidiInstrument[] {
  const exceptTrackId = sourceSpans.find(
    (span) => span.id === exceptSpanId,
  )?.sourceTrackId;
  return sourceTracks.flatMap((track) => {
    if (
      !armedTrackIds.has(track.id) ||
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
        return instrument ? [{ startQ: span.startQ, instrument }] : [];
      })
      .sort((a, b) => a.startQ - b.startQ);
    const clip =
      played.findLast(({ startQ }) => startQ <= playheadQ) ?? played[0];
    return clip ? [clip.instrument] : [];
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
let playheadQ = () => 0;

export function setArmedAuditionSource(
  nextSession: ArmedAuditionSession,
  nextPlayheadQ: () => number,
) {
  session = nextSession;
  playheadQ = nextPlayheadQ;
}

/**
 * Plays `pitch` on every armed track but the one owning `exceptSpanId`, held
 * until the voice is released, which a Drum Rack's one-shot pads don't wait for.
 */
export function auditionArmedTracks(
  pitch: number,
  expression: ExpressionSample | undefined,
  exceptSpanId?: string,
) {
  return combineVoices(
    armedInstruments(
      getArmedTrackIds(),
      session,
      playheadQ(),
      exceptSpanId,
    ).map((instrument) => auditionNote(pitch, instrument, expression, true)),
  );
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
