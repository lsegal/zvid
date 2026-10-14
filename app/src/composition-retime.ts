// The media clips a Retime on their own stack plays at another speed (see
// fx/effects/retime/retime.ts), which their timing reads.
import type {
  ArrangementClip,
  SessionEffect,
} from "./composition-active-clips.ts";
import type { ClipRetimes } from "./composition-clip-timing.ts";
import { type EffectIndex, stackEffects } from "./composition-effect-index.ts";
import {
  type RetimeSettings,
  resolveRetime,
} from "./fx/effects/retime/retime.ts";
import { clipEffectTrackId } from "./fx-stack.ts";

// They depend only on the clips and effects, so they are worked out once
// per index and clip list rather than every frame.
const retimesCache = new WeakMap<
  EffectIndex<SessionEffect>,
  {
    clips: readonly ArrangementClip[];
    byClip: ReadonlyMap<string, RetimeSettings>;
  }
>();

// The Retimes of `clips`, with Blend counting a video's frames at the
// session's `frameRate`.
export function findClipRetimes(
  clips: readonly ArrangementClip[],
  effects: EffectIndex<SessionEffect>,
  frameRate: number,
): ClipRetimes {
  const cached = retimesCache.get(effects);
  if (cached?.clips === clips) {
    return { byClip: cached.byClip, frameRate };
  }
  const byClip = new Map<string, RetimeSettings>();
  for (const clip of clips) {
    if (clip.kind) {
      continue;
    }
    const trackId = clipEffectTrackId(clip.id);
    const retime = resolveRetime(stackEffects(effects, trackId), trackId);
    if (retime) {
      byClip.set(clip.id, retime);
    }
  }
  retimesCache.set(effects, { clips, byClip });
  return { byClip, frameRate };
}
