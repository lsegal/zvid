// Which clips the audio mix plays, decided independently of video (see
// render-clips.ts): when any layer clip's media has audio, only those layer
// clips sound and the source tracks are silent; otherwise every source clip
// whose media has audio sounds. So a session whose layers hold only fill or
// text clips renders video from the layers and audio from the source
// tracks. Preview, export and audio-reactive effects all mix these clips.
//
// The mix is a graph of effect chains (see chain.ts): each clip through its
// own stack, summed into its layer's or source track's bus, which runs that
// track's stack, then summed into the master, which runs the Global stack,
// then the limiter. Gain is one stage among them; a clip with no enabled
// Gain on its track's stack or its own stays silent.
import { quartersToSeconds } from "../app/timeline-math.ts";
import type { ClipWarp } from "../clip-warp.ts";
import {
  gainChainAmplitude,
  isGainEffectName,
  masterGainAmplitude,
} from "../fx/effects/gain/gain.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { isAudioEffectName } from "../fx-registry.ts";
import { sourceRenderClipId } from "../render-clips.ts";
import {
  type AudioStage,
  type AudioTimeSignature,
  DEFAULT_TIME_SIGNATURE,
} from "./processor.ts";
import { type AudioStageEffect, audioStageOf } from "./stages.ts";

type AudioEffect = AudioStageEffect;

type AudioLayerClip = {
  id: string;
  kind?: string;
  laneId: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  warp?: ClipWarp;
};

type AudioSourceSpan = {
  id: string;
  sourceTrackId: string;
  mediaId?: string;
  startQ: number;
  durationSeconds: number;
  trimStartSeconds: number;
  warp?: ClipWarp;
};

// A layer or source track whose FX switch is off bypasses its own stack and
// its clips' stacks, Gain included.
type AudioTrack = { id: string; fxEnabled?: boolean };

export type AudioMixInputs<Effect extends AudioEffect = AudioEffect> = {
  clips: readonly AudioLayerClip[];
  lanes: readonly AudioTrack[];
  sourceTracks: readonly AudioTrack[];
  sourceSpans: readonly AudioSourceSpan[];
  mediaById: ReadonlyMap<string, { hasAudio: boolean }>;
  effects: readonly Effect[];
  bpm: number;
  // 4/4 when unset.
  signature?: AudioTimeSignature;
};

// A clip the mix plays. Its media plays the way the clip's video does: the
// source time at timeline second `t` is `t + sourceOffsetSeconds`, inside
// the source window, through the clip's warp markers when it has them.
export type AudioMixClip<Effect extends AudioEffect = AudioEffect> = {
  // The layer clip's id, or the source clip's render id.
  id: string;
  mediaId: string;
  startSeconds: number;
  durationSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  warp?: ClipWarp;
  // Its audio effects, Global first, then its layer's or source track's,
  // then its own; bypassed stacks are left out.
  effects: Effect[];
  // The product of the enabled Gains on its layer's or source track's stack
  // and its own: 0 without any.
  amplitude: number;
  // Whether its layer's or source track's stack, or its own, has an enabled
  // Gain; without one the clip is silent.
  hasGain: boolean;
  // The bus it sums into: its layer's or source track's id.
  busId: string;
  // Its own stack's audio effects, in rack order; bypassed stacks' stages
  // are disabled.
  stages: AudioStage[];
};

// A layer's or source track's bus: the sum of its clips through its own
// stack.
export type AudioMixBus = {
  id: string;
  stages: AudioStage[];
};

export type AudioMix<Effect extends AudioEffect = AudioEffect> = {
  clips: AudioMixClip<Effect>[];
  // Every bus a clip sums into.
  buses: AudioMixBus[];
  // The Global stack's audio effects, run on the whole mix.
  master: AudioStage[];
  // The Global stack's Gains, applied to the whole mix: 1 without any.
  masterAmplitude: number;
  // Whether the clips come from the source tracks rather than the layers.
  fromSourceTracks: boolean;
  bpm: number;
  signature: AudioTimeSignature;
};

export const SILENT_AUDIO_MIX: AudioMix = {
  clips: [],
  buses: [],
  master: [],
  masterAmplitude: 1,
  fromSourceTracks: false,
  bpm: 120,
  signature: DEFAULT_TIME_SIGNATURE,
};

function hasAudio(
  mediaById: AudioMixInputs["mediaById"],
  mediaId: string | undefined,
) {
  return mediaId !== undefined && mediaById.get(mediaId)?.hasAudio === true;
}

export function resolveAudioClips<Effect extends AudioEffect>({
  clips,
  lanes,
  sourceTracks,
  sourceSpans,
  mediaById,
  effects,
  bpm,
  signature = DEFAULT_TIME_SIGNATURE,
}: AudioMixInputs<Effect>): AudioMix<Effect> {
  const audioEffects = new Map<string, Effect[]>();
  for (const effect of effects) {
    if (!isAudioEffectName(effect.effectName)) {
      continue;
    }
    const stack = audioEffects.get(effect.trackId);
    if (stack) {
      stack.push(effect);
    } else {
      audioEffects.set(effect.trackId, [effect]);
    }
  }
  const stackOf = (trackId: string) => audioEffects.get(trackId) ?? [];
  const global = stackOf(GLOBAL_EFFECT_TRACK_ID);
  const bypassed = new Set(
    [...lanes, ...sourceTracks]
      .filter((track) => track.fxEnabled === false)
      .map((track) => track.id),
  );

  const stagesOf = (stackId: string, enabled = true) =>
    stackOf(stackId).map((effect, index) =>
      audioStageOf(effect, `${stackId}:${index}`, enabled),
    );
  const buses = new Map<string, AudioMixBus>();
  const busOf = (trackId: string, trackStackId: string) => {
    let bus = buses.get(trackId);
    if (!bus) {
      bus = {
        id: trackId,
        stages: stagesOf(trackStackId, !bypassed.has(trackId)),
      };
      buses.set(trackId, bus);
    }
    return bus;
  };

  // A clip's chain below Global: its track's stack, then its own.
  const mixClip = (
    clip: Omit<
      AudioMixClip<Effect>,
      "effects" | "amplitude" | "hasGain" | "busId" | "stages"
    >,
    trackId: string,
    trackStackId: string,
    clipStackId: string,
  ): AudioMixClip<Effect> => {
    const own = bypassed.has(trackId)
      ? []
      : [...stackOf(trackStackId), ...stackOf(clipStackId)];
    return {
      ...clip,
      effects: [...global, ...own],
      amplitude: gainChainAmplitude(own),
      hasGain: own.some(
        (effect) =>
          effect.enabled !== false && isGainEffectName(effect.effectName),
      ),
      busId: busOf(trackId, trackStackId).id,
      stages: stagesOf(clipStackId, !bypassed.has(trackId)),
    };
  };
  const master = stagesOf(GLOBAL_EFFECT_TRACK_ID);

  const layerClips = clips.filter(
    (clip) => !clip.kind && hasAudio(mediaById, clip.mediaId),
  );
  if (layerClips.length) {
    const mixed = layerClips.map((clip) =>
      mixClip(
        {
          id: clip.id,
          mediaId: clip.mediaId as string,
          startSeconds: quartersToSeconds(clip.startQ, bpm),
          durationSeconds: clip.durationSeconds,
          sourceOffsetSeconds: clip.sourceOffsetSeconds,
          sourceWindowStartSeconds: clip.sourceWindowStartSeconds,
          sourceWindowEndSeconds: clip.sourceWindowEndSeconds,
          ...(clip.warp ? { warp: clip.warp } : {}),
        },
        clip.laneId,
        clip.laneId,
        clipEffectTrackId(clip.id),
      ),
    );
    return {
      clips: mixed,
      buses: [...buses.values()],
      master,
      masterAmplitude: masterGainAmplitude(global),
      fromSourceTracks: false,
      bpm,
      signature,
    };
  }

  const mixed = sourceSpans
    .filter((span) => hasAudio(mediaById, span.mediaId))
    .map((span) => {
      const startSeconds = quartersToSeconds(span.startQ, bpm);
      return mixClip(
        {
          id: sourceRenderClipId(span.id),
          mediaId: span.mediaId as string,
          startSeconds,
          durationSeconds: span.durationSeconds,
          sourceOffsetSeconds: span.trimStartSeconds - startSeconds,
          sourceWindowStartSeconds: span.trimStartSeconds,
          sourceWindowEndSeconds: span.trimStartSeconds + span.durationSeconds,
          ...(span.warp ? { warp: span.warp } : {}),
        },
        span.sourceTrackId,
        sourceTrackEffectTrackId(span.sourceTrackId),
        sourceClipEffectTrackId(span.id),
      );
    });
  return {
    clips: mixed,
    buses: [...buses.values()],
    master,
    masterAmplitude: masterGainAmplitude(global),
    fromSourceTracks: true,
    bpm,
    signature,
  };
}
