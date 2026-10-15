// A media layer clip inherits the effects of the source it shows: each piece
// of the clip (see render-clips.ts) is drawn and played through its source
// track's stack, then the stack of the source clip (span) it shows, ahead
// of the clip's own stack, so the source's effects sit closest to the media
// and the clip's own still override them. They are read from the session at
// render time, never copied, so editing a source stack changes every layer
// clip made from it at once.
//
// Inherited effects animate on the source's time, as they do where the
// source tracks render in place of layers: a layer clip slipped along its
// source track shows the same animation with the same media. Reactive mode
// follows the mix at the frame drawn, which is that media's sound.
//
// When the source tracks render in place of layers there are no layer
// clips, and their stacks already apply to their virtual layers and clips,
// so nothing is inherited twice.
import { quartersToSeconds, secondsToQuarters } from "./app/timeline-math.ts";
import type { EffectIndex } from "./composition-effect-index.ts";
import {
  clipEffectTrackId,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./fx/stack/clip-stacks.ts";
import {
  type AnimatableEffect,
  type AnimationFrameContext,
  reactsToAudio,
  resolveAnimatedParameters,
} from "./fx-animation.ts";
import { clipSessionEdges } from "./fx-animation-clip.ts";
import {
  isSourceRenderId,
  sourceRenderClipId,
  sourceRenderLaneId,
} from "./render-clips.ts";

type StackEffect = { trackId: string };

// The piece of a layer clip whose source's effects are inherited.
export type InheritingClip = {
  id: string;
  kind?: string;
  sourceTrackId: string;
  sourceSpanId?: string;
  sourceOffsetSeconds: number;
  sourceSpanOffsetSeconds?: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
};

// The effects a layer clip showing `sourceSpanId` on `sourceTrackId`
// inherits, in the order they apply: the source track's stack, then the
// source clip's.
export function sourceStackEffects<T extends StackEffect>(
  index: EffectIndex<T>,
  sourceTrackId: string,
  sourceSpanId: string | undefined,
): T[] {
  const trackStack =
    index.byTrack.get(sourceTrackEffectTrackId(sourceTrackId)) ?? [];
  const clipStack =
    sourceSpanId === undefined
      ? []
      : (index.byTrack.get(sourceClipEffectTrackId(sourceSpanId)) ?? []);
  return clipStack.length ? [...trackStack, ...clipStack] : trackStack;
}

// Whether `clip` is a piece of a media layer clip, which inherits its
// source's effects, rather than a fill, text or FX clip or a source clip
// rendered in place of a layer clip.
function inheritsSourceEffects(clip: InheritingClip) {
  return !clip.kind && !isSourceRenderId(clip.id);
}

// `effects`, the Global, layer and own stacks `clip` is drawn with, with
// its source's effects at `frameContext` inserted ahead of its own stack,
// as part of it. Returns `effects` itself when the source has none.
export function withInheritedSourceEffects<
  T extends AnimatableEffect & StackEffect,
>(
  effects: T[],
  index: EffectIndex<T>,
  clip: InheritingClip,
  frameContext: AnimationFrameContext,
  sessionEndSeconds: number,
): T[] {
  if (!inheritsSourceEffects(clip)) {
    return effects;
  }
  const inherited = sourceStackEffects(
    index,
    clip.sourceTrackId,
    clip.sourceSpanId,
  );
  if (!inherited.length) {
    return effects;
  }

  const clipTrackId = clipEffectTrackId(clip.id);
  const resolved = resolveSourceTimedEffects(
    inherited,
    clip,
    frameContext,
    sessionEndSeconds,
  ).map((effect) => ({ ...effect, trackId: clipTrackId }));
  const ownStart = effects.findIndex(
    (effect) => effect.trackId === clipTrackId,
  );
  return ownStart < 0
    ? [...effects, ...resolved]
    : [...effects.slice(0, ownStart), ...resolved, ...effects.slice(ownStart)];
}

// `effects` animated as they are on the source clip `clip` shows, where it
// renders in place of a layer clip: on the source track's time, over the
// source clip's length.
function resolveSourceTimedEffects<T extends AnimatableEffect & StackEffect>(
  effects: T[],
  clip: InheritingClip,
  frameContext: AnimationFrameContext,
  sessionEndSeconds: number,
): T[] {
  if (!effects.some((effect) => effect.animation?.enabled)) {
    return effects;
  }
  const { bpm, fps } = frameContext;
  // Media second minus song second for the source clip where it sits on
  // its track, and for it as `clip` shows it (see source-track-content.ts).
  const spanOffsetSeconds =
    clip.sourceSpanOffsetSeconds ?? clip.sourceOffsetSeconds;
  const sourceFrame = {
    ...frameContext,
    playheadQ:
      frameContext.playheadQ +
      secondsToQuarters(clip.sourceOffsetSeconds - spanOffsetSeconds, bpm),
  };
  // The source clip's window starts at its trimmed start.
  const startSeconds = clip.sourceWindowStartSeconds - spanOffsetSeconds;
  const durationSeconds = Math.max(
    0,
    clip.sourceWindowEndSeconds - clip.sourceWindowStartSeconds,
  );
  const elapsedSeconds =
    quartersToSeconds(sourceFrame.playheadQ, bpm) - startSeconds;
  const clipContext = {
    clipId: sourceRenderClipId(clip.sourceSpanId ?? clip.id),
    laneId: sourceRenderLaneId(clip.sourceTrackId),
    progress:
      durationSeconds > 0
        ? Math.min(1, Math.max(0, elapsedSeconds / durationSeconds))
        : 0,
    elapsedSeconds,
    durationSeconds,
    sessionEdges: clipSessionEdges(
      startSeconds,
      durationSeconds,
      sessionEndSeconds,
      fps,
    ),
  };
  return effects.map((effect) => {
    if (!effect.animation?.enabled) {
      return effect;
    }
    const parameters = resolveAnimatedParameters(
      effect,
      clipContext,
      reactsToAudio(effect) ? frameContext : sourceFrame,
    );
    return parameters === effect.parameters
      ? effect
      : { ...effect, parameters };
  });
}
