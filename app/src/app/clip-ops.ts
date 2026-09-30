import { clipEffectTrackId, type SessionEffect } from "../fx-stack.ts";
import type { ClipboardContent } from "../range-edit.ts";
import { getClipEndQ, quartersToSeconds } from "./timeline-math.ts";
import type { ArrangementClip } from "./types.ts";

export function cloneClipAtStartQ(
  clip: ArrangementClip,
  bpm: number,
  startQ: number,
  id = `window-${crypto.randomUUID()}`,
) {
  return {
    ...clip,
    id,
    startQ,
    trimStartSeconds: clip.trimStartSeconds,
    sourceOffsetSeconds: clip.trimStartSeconds - quartersToSeconds(startQ, bpm),
  };
}

// Clipboard content with the effect stacks of the clips it was copied from,
// taken when copying, so a cut clip still pastes with its effects.
export type ClipClipboard = ClipboardContent<ArrangementClip> & {
  effects?: SessionEffect[];
};

export function withClipStacks(
  content: ClipboardContent<ArrangementClip>,
  effects: readonly SessionEffect[],
): ClipClipboard {
  const trackIds = new Set(
    content.fragments.map((fragment) => clipEffectTrackId(fragment.clip.id)),
  );
  return {
    ...content,
    effects: effects.filter((effect) => trackIds.has(effect.trackId)),
  };
}

export function duplicateClip(
  clip: ArrangementClip,
  bpm: number,
  id = `window-${crypto.randomUUID()}`,
) {
  return cloneClipAtStartQ(clip, bpm, getClipEndQ(clip, bpm), id);
}
