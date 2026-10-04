// Which FX clips have a Transition, and what each draws with at a frame:
// its settings, how far it has got, and the clips in its two comps.
import type {
  ArrangementClip,
  SessionEffect,
} from "./composition-active-clips.ts";
import type { ActiveClipTiming } from "./composition-clip-timing.ts";
import { type EffectIndex, stackEffects } from "./composition-effect-index.ts";
import type { TransitionComps } from "./composition-layout.ts";
import {
  findTransitionEffect,
  parseTransitionSettings,
  TRANSITION_EFFECT_NAME,
  type TransitionSettings,
  transitionProgress,
} from "./fx/effects/transition/transition.ts";
import {
  createDefaultAnimation,
  getClipTimingFrames,
} from "./fx-animation-defaults.ts";
import { clipEffectTrackId } from "./fx-stack.ts";

// The FX clips among `clips` whose own stack has an enabled Transition.
export function findTransitionClips(
  clips: readonly ArrangementClip[],
  effects: EffectIndex<SessionEffect>,
) {
  return clips.filter((clip) => {
    if (clip.kind !== "fx") {
      return false;
    }
    const trackId = clipEffectTrackId(clip.id);
    return Boolean(
      findTransitionEffect(stackEffects(effects, trackId), trackId),
    );
  });
}

// What the last enabled Transition on the `trackId` stack of an FX clip
// draws with, `elapsedSeconds` into the clip's `durationSeconds` at `fps`,
// between the clips `comps` gives, which is only asked when there is one.
// Its Animation times it; with the Animation off it is timed as a new one
// is.
export function resolveClipTransition(
  effects: readonly SessionEffect[],
  trackId: string,
  fps: number,
  elapsedSeconds: number,
  durationSeconds: number,
  comps: () => { outgoing: ActiveClipTiming[]; incoming: ActiveClipTiming[] },
): (TransitionSettings & TransitionComps) | undefined {
  const effect = findTransitionEffect(effects, trackId);
  const animation = effect?.animation?.enabled
    ? effect.animation
    : createDefaultAnimation(TRANSITION_EFFECT_NAME);
  if (!effect || !animation) {
    return undefined;
  }

  const { outgoing, incoming } = comps();
  const frames =
    getClipTimingFrames(TRANSITION_EFFECT_NAME, animation.clip.timing) ??
    Number.POSITIVE_INFINITY;
  const seconds = fps > 0 ? frames / fps : Number.POSITIVE_INFINITY;
  return {
    ...parseTransitionSettings(
      effect.parameters,
      transitionProgress(
        animation.clip,
        seconds,
        elapsedSeconds,
        durationSeconds,
      ),
    ),
    outgoing: new Set(outgoing.map(({ clip }) => clip.id)),
    incoming: new Set(incoming.map(({ clip }) => clip.id)),
  };
}
