// Picks the media a shared session still needs from peers. Every media the
// session references counts: the main audio, arrangement clips and source
// spans, so footage that is only on source tracks reaches joiners too.

import type { MediaAvailability } from "./media.ts";

export type SessionMediaRange = {
  mediaId?: string;
  startQ: number;
  endQ: number;
};

export type OfflineSessionMediaOptions = {
  availability(mediaId: string): MediaAvailability | undefined;
  mainAudioId?: string;
  clips: SessionMediaRange[];
  sourceSpans: SessionMediaRange[];
  playheadQ: number;
  visibleStartQ: number;
  visibleEndQ: number;
};

const MAIN_AUDIO_PRIORITY = 0;
const PLAYHEAD_PRIORITY = 1;
const VISIBLE_PRIORITY = 2;
const OTHER_PRIORITY = 3;

/**
 * Lists the ids of offline media the session references, in the order they
 * should be requested: the main audio first, since it drives playback and the
 * waveform, then media under the playhead, then visible media, then the rest.
 * Ties keep the order the media first appears in.
 */
export function offlineSessionMediaIds({
  availability,
  mainAudioId,
  clips,
  sourceSpans,
  playheadQ,
  visibleStartQ,
  visibleEndQ,
}: OfflineSessionMediaOptions): string[] {
  const priorities = new Map<string, number>();
  const consider = (mediaId: string | undefined, priority: number) => {
    if (!mediaId || availability(mediaId) !== "offline") {
      return;
    }
    const current = priorities.get(mediaId);
    if (current === undefined || priority < current) {
      priorities.set(mediaId, priority);
    }
  };

  consider(mainAudioId, MAIN_AUDIO_PRIORITY);
  for (const range of [...clips, ...sourceSpans]) {
    consider(
      range.mediaId,
      range.startQ <= playheadQ && playheadQ < range.endQ
        ? PLAYHEAD_PRIORITY
        : range.startQ < visibleEndQ && visibleStartQ < range.endQ
          ? VISIBLE_PRIORITY
          : OTHER_PRIORITY,
    );
  }

  // Map iteration keeps insertion order and the sort is stable.
  return Array.from(priorities)
    .sort(([, left], [, right]) => left - right)
    .map(([mediaId]) => mediaId);
}

/**
 * Forgets a remembered peer miss for the main audio when it changes, so a
 * main audio the host adds or replaces during a share is requested right away
 * even if an earlier request for that id came back empty.
 */
export function forgetChangedMainAudioMiss(
  misses: Set<string>,
  previousMainAudioId: string | undefined,
  mainAudioId: string | undefined,
) {
  if (mainAudioId && mainAudioId !== previousMainAudioId) {
    misses.delete(mainAudioId);
  }
}
