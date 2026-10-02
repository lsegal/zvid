// Every clip with sound gets a Gain at 0 dB in its own stack when it is
// made, since a clip makes sound only through Gain. Copies carry their
// stack instead, so a copy of a clip whose Gain was removed stays silent.
// An older session's clips get theirs on open, before their media is read,
// and lose it again once their media turns out to have no sound.

import { GAIN_EFFECT_NAME, isGainEffectName } from "./fx/effects/gain/gain.ts";
import {
  clipEffectTrackId,
  sourceClipEffectTrackId,
} from "./fx/stack/clip-stacks.ts";
import { createEffect } from "./fx/stack/ops.ts";
import type { SessionEffect } from "./fx/stack/types.ts";
import type { MediaItem } from "./media.ts";

type GainMedia = Pick<MediaItem, "id" | "hasAudio" | "durationSeconds">;

// An arrangement clip; fill, text and FX clips set `kind` and have no sound.
type GainClip = { id: string; kind?: string; mediaId?: string };

type GainSpan = { id: string; mediaId?: string };

export type DefaultGainTargets = {
  clips?: readonly GainClip[];
  sourceSpans?: readonly GainSpan[];
};

// Whether a media clip may have sound. Media that hasn't been read yet,
// such as a just-opened session's placeholders, has no duration and may.
function mayHaveAudio(
  mediaId: string | undefined,
  mediaById: ReadonlyMap<string, GainMedia>,
) {
  const media = mediaId === undefined ? undefined : mediaById.get(mediaId);
  return !media || media.hasAudio || !(media.durationSeconds > 0);
}

// The stacks of `targets` that may have sound.
function audioStackIds(
  targets: DefaultGainTargets,
  mediaItems: readonly GainMedia[],
) {
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  return [
    ...(targets.clips ?? [])
      .filter(
        (clip) =>
          clip.kind === undefined && mayHaveAudio(clip.mediaId, mediaById),
      )
      .map((clip) => clipEffectTrackId(clip.id)),
    ...(targets.sourceSpans ?? [])
      .filter((span) => mayHaveAudio(span.mediaId, mediaById))
      .map((span) => sourceClipEffectTrackId(span.id)),
  ];
}

// Gives each of `targets` that may have sound a Gain at 0 dB, at the end of
// its own stack, unless the stack already has a Gain. Returns `effects`
// itself when none needs one. `defaulted` marks the Gains so they can be
// dropped again if their media turns out to have no sound.
export function addDefaultGain(
  effects: SessionEffect[],
  targets: DefaultGainTargets,
  mediaItems: readonly GainMedia[],
  createId: () => string = () => crypto.randomUUID(),
  defaulted = false,
) {
  const withGain = new Set(
    effects
      .filter((effect) => isGainEffectName(effect.effectName))
      .map((effect) => effect.trackId),
  );
  const added = audioStackIds(targets, mediaItems)
    .filter((trackId) => !withGain.has(trackId))
    .filter((trackId, index, ids) => ids.indexOf(trackId) === index)
    .map((trackId) => ({
      ...createEffect(trackId, GAIN_EFFECT_NAME, createId()),
      ...(defaulted ? { defaulted } : {}),
    }));
  return added.length ? [...effects, ...added] : effects;
}

// Sessions saved before clips needed Gain to sound had none. Opening one
// gives each source clip and layer clip that may have sound a Gain at 0 dB,
// so it sounds as it did. A session saved since carries
// `audioGainDefaulted` and opens with its stacks as saved, so a Gain the
// user removed stays removed. The Gains added are marked `defaulted`, since
// media not read yet may turn out to have no sound (pruneDefaultGain).
export function migrateDefaultGain(
  effects: SessionEffect[],
  targets: DefaultGainTargets,
  mediaItems: readonly GainMedia[],
  audioGainDefaulted: boolean | undefined,
  createId?: () => string,
) {
  return audioGainDefaulted === true
    ? effects
    : addDefaultGain(effects, targets, mediaItems, createId, true);
}

// Drops the Gains an older session's open gave to clips whose media, now
// read, has no sound. A Gain the user has edited since, or added, is kept.
// Returns `effects` itself when none is dropped.
export function pruneDefaultGain(
  effects: SessionEffect[],
  targets: DefaultGainTargets,
  mediaItems: readonly GainMedia[],
) {
  if (!effects.some((effect) => effect.defaulted)) {
    return effects;
  }
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  const isSilent = (mediaId: string | undefined) =>
    mediaId !== undefined &&
    mediaById.has(mediaId) &&
    !mayHaveAudio(mediaId, mediaById);
  const silentStacks = new Set([
    ...(targets.clips ?? [])
      .filter((clip) => isSilent(clip.mediaId))
      .map((clip) => clipEffectTrackId(clip.id)),
    ...(targets.sourceSpans ?? [])
      .filter((span) => isSilent(span.mediaId))
      .map((span) => sourceClipEffectTrackId(span.id)),
  ]);
  const kept = effects.filter(
    (effect) =>
      !(
        effect.defaulted &&
        isGainEffectName(effect.effectName) &&
        silentStacks.has(effect.trackId)
      ),
  );
  return kept.length === effects.length ? effects : kept;
}
