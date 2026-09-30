import { isColorEffectName } from "./fill-paint.ts";
import {
  clipEffectTrackId,
  ensureGlobalOrder,
  getTrackGroup,
  type SessionEffect,
} from "./fx-stack.ts";
import { isTextEffectName } from "./text-style.ts";

// Collaboration peers on builds from before the "main audio" rename publish
// the session's main audio as `masterAudioId`. Reading it keeps their audio
// selection when they share a room with newer peers.
export function migrateLegacyMainAudio<T extends object>(snapshot: T): T {
  if (!("masterAudioId" in snapshot)) {
    return snapshot;
  }
  const { masterAudioId, ...rest } = snapshot as T & {
    mainAudioId?: string;
    masterAudioId?: string;
  };
  return {
    ...rest,
    mainAudioId: rest.mainAudioId ?? masterAudioId,
  } as T;
}

// Peers on builds from before selection was per-user mark clips with a
// `selected` flag. Selection is local, so drop it rather than let a stale
// flag travel with the project.
export function stripClipSelectionFlags<T extends object>(snapshot: T): T {
  const { clips } = snapshot as T & { clips?: unknown };
  if (
    !Array.isArray(clips) ||
    !clips.some(
      (clip) => typeof clip === "object" && clip && "selected" in clip,
    )
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    clips: clips.map((clip) => {
      if (typeof clip !== "object" || !clip || !("selected" in clip)) {
        return clip;
      }
      const { selected: _selected, ...rest } = clip;
      return rest;
    }),
  };
}

// Sessions saved before layers could overlap had no Order effect and were
// arranged in Vertical bands anyway. Opening one adds that Order so it looks
// the same, so it comes without animation. A session saved since carries
// `orderDefaulted` and opens with its Global stack as saved, so an Order the
// user removed stays removed.
export function migrateDefaultOrder(
  effects: SessionEffect[],
  orderDefaulted: boolean | undefined,
) {
  if (orderDefaulted === true) {
    return effects;
  }

  const migrated = ensureGlobalOrder(effects);
  return migrated === effects
    ? effects
    : migrated.map((effect) => {
        if (effects.includes(effect)) {
          return effect;
        }
        const { animation: _animation, ...rest } = effect;
        return rest;
      });
}

type ContentClip = { id: string; laneId: string; kind?: string };

// Sessions saved before clips had their own stacks styled every text clip
// on a layer with the layer's Text effect, and painted its fill clips with
// the layer's Color. Opening one gives each text clip a copy of its layer's
// Text effects and each fill clip a copy of its layer's Color effects, so
// it looks the same. Text is clip-only now, so it leaves the layer; Color
// leaves a layer only when it has fill clips and nothing else. A clip that already
// has its own Text or Color keeps it. A session saved since carries
// `clipContentEffects` and opens with its stacks as saved.
export function migrateClipContentEffects(
  effects: SessionEffect[],
  clips: readonly ContentClip[],
  clipContentEffects: boolean | undefined,
  createId: () => string = () => crypto.randomUUID(),
) {
  if (clipContentEffects === true) {
    return effects;
  }

  const moves = [
    { kind: "text", isContent: isTextEffectName },
    { kind: "fill", isContent: isColorEffectName },
  ] as const;
  const removedIds = new Set<string>();
  const copies = new Map<string, SessionEffect[]>();
  for (const { kind, isContent } of moves) {
    const layerEffects = effects.filter(
      (effect) =>
        getTrackGroup(effect.trackId) === "layer" &&
        isContent(effect.effectName),
    );
    for (const laneId of new Set(
      layerEffects.map((effect) => effect.trackId),
    )) {
      const laneClips = clips.filter((clip) => clip.laneId === laneId);
      const targets = laneClips.filter((clip) => clip.kind === kind);
      if (
        kind === "text" ||
        (targets.length && targets.length === laneClips.length)
      ) {
        for (const effect of layerEffects) {
          if (effect.trackId === laneId) {
            removedIds.add(effect.id);
          }
        }
      }
      for (const clip of targets) {
        const trackId = clipEffectTrackId(clip.id);
        if (
          effects.some(
            (effect) =>
              effect.trackId === trackId && isContent(effect.effectName),
          )
        ) {
          continue;
        }
        copies.set(trackId, [
          ...(copies.get(trackId) ?? []),
          ...layerEffects
            .filter((effect) => effect.trackId === laneId)
            .map((effect) => ({
              ...effect,
              id: createId(),
              trackId,
              parameters: effect.parameters.map((parameter) => ({
                ...parameter,
              })),
            })),
        ]);
      }
    }
  }

  if (!removedIds.size && !copies.size) {
    return effects;
  }

  // Each copy leads its clip's stack, ahead of any effects it already has.
  const result: SessionEffect[] = [];
  for (const effect of effects) {
    const copied = copies.get(effect.trackId);
    if (copied) {
      result.push(...copied);
      copies.delete(effect.trackId);
    }
    if (!removedIds.has(effect.id)) {
      result.push(effect);
    }
  }
  for (const copied of copies.values()) {
    result.push(...copied);
  }
  return result;
}
