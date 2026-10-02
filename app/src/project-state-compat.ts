import type { ProjectState, SourceSpan, SourceTrack } from "./app/types.ts";
import { getSwatch, stripFilenameExtension } from "./app/util.ts";
import { isColorEffectName } from "./fill-paint.ts";
import {
  isOrderEffectName,
  LEGACY_OUTER_MARGIN_KEY,
  MARGIN_KEY,
  parseCompositionOrder,
} from "./fx/effects/order/order.ts";
import { createDefaultAnimation } from "./fx-animation-defaults.ts";
import {
  clipEffectTrackId,
  ensureGlobalOrder,
  getTrackGroup,
  type SessionEffect,
} from "./fx-stack.ts";
import type { MediaItem } from "./media.ts";
import { nextSourceTrackColorIndex } from "./source-track-color.ts";
import { isTextEffectName } from "./text-style.ts";

type MainAudioState = Pick<
  ProjectState,
  "mediaItems" | "sourceTracks" | "sourceSpans"
>;

// The source track and clip a session's main audio becomes. Their ids come
// from the media's, so peers migrating the same snapshot agree on them.
export function mainAudioSourceTrackId(mediaId: string) {
  return `main-audio-track-${mediaId}`;
}

export function mainAudioSourceSpanId(mediaId: string) {
  return `main-audio-span-${mediaId}`;
}

// Sessions used to have one "main audio" file, saved as `mainAudioId` (or
// `masterAudioId` on builds before that rename). Audio comes only from clips
// now, so the main audio becomes a source track of its own, named after the
// file, with one clip of the whole file from time 0, and the field is
// dropped. A file whose length is not known yet, as when a session file is
// opened before its media is analyzed, gets `fallbackDurationSeconds` and is
// marked to fit the file once its length is known.
export function migrateMainAudio<T extends MainAudioState>(
  snapshot: T & { mainAudioId?: string; masterAudioId?: string },
  fallbackDurationSeconds = 0,
): T {
  if (!("mainAudioId" in snapshot) && !("masterAudioId" in snapshot)) {
    return snapshot;
  }

  const { mainAudioId, masterAudioId, ...rest } = snapshot;
  const state = rest as unknown as T;
  const mediaId = mainAudioId ?? masterAudioId;
  const media = mediaId
    ? state.mediaItems.find((item) => item.id === mediaId)
    : undefined;
  const trackId = mediaId ? mainAudioSourceTrackId(mediaId) : "";
  if (!media || state.sourceTracks.some((track) => track.id === trackId)) {
    return state;
  }

  const mediaPath = media.sourcePath ?? media.name;
  const track: SourceTrack = {
    id: trackId,
    name: stripFilenameExtension(media.name),
    colorIndex: nextSourceTrackColorIndex(state.sourceTracks),
    recordingPaths: [mediaPath],
  };
  const swatch = getSwatch(track.colorIndex);
  const known = media.durationSeconds > 0;
  const span: SourceSpan = {
    id: mainAudioSourceSpanId(media.id),
    sourceTrackId: track.id,
    label: track.name,
    mediaPath,
    mediaId: media.id,
    startQ: 0,
    durationSeconds: known
      ? media.durationSeconds
      : Math.max(1, fallbackDurationSeconds),
    trimStartSeconds: 0,
    ...(known ? {} : { fitsMedia: true as const }),
    tint: swatch.color,
    accent: swatch.accent,
  };
  return {
    ...state,
    sourceTracks: [...state.sourceTracks, track],
    sourceSpans: [...state.sourceSpans, span],
  };
}

// Sets source clips marked to fit their media to its length, once it is
// known.
export function fitSourceSpansToMedia(
  sourceSpans: SourceSpan[],
  mediaItems: readonly MediaItem[],
) {
  if (!sourceSpans.some((span) => span.fitsMedia)) {
    return sourceSpans;
  }

  let changed = false;
  const next = sourceSpans.map((span) => {
    const durationSeconds = span.fitsMedia
      ? mediaItems.find((item) => item.id === span.mediaId)?.durationSeconds
      : undefined;
    if (!durationSeconds || !(durationSeconds > 0)) {
      return span;
    }

    changed = true;
    const { fitsMedia: _fitsMedia, ...rest } = span;
    return { ...rest, durationSeconds };
  });
  return changed ? next : sourceSpans;
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

const COLORIZE_REACTIVITY_KEY = "_Reactivity";

// Colorize used to swing its hue on audio hits by its own Reactivity knob.
// The music moves an effect only through its Animation modifier now, so a
// Colorize saved with Reactivity above 0 and no animation opens with Reactive
// mode on, moving Hue Shift at that Reactivity, and keeps pulsing. The old
// knob is dropped either way, so it is not saved again.
export function migrateColorizeReactivity(effects: SessionEffect[]) {
  if (
    !effects.some(
      (effect) =>
        effect.effectName === "Colorize" &&
        effect.parameters.some(
          (parameter) => parameter.key === COLORIZE_REACTIVITY_KEY,
        ),
    )
  ) {
    return effects;
  }

  return effects.map((effect) => {
    const old = effect.parameters.find(
      (parameter) => parameter.key === COLORIZE_REACTIVITY_KEY,
    );
    if (effect.effectName !== "Colorize" || !old) {
      return effect;
    }

    const parameters = effect.parameters.filter(
      (parameter) => parameter !== old,
    );
    const reactivity = Math.min(
      1,
      old.numericValue ?? Number.parseFloat(old.value),
    );
    const defaults = createDefaultAnimation(effect.effectName);
    if (effect.animation || !defaults?.reactive || !(reactivity > 0)) {
      return { ...effect, parameters };
    }
    return {
      ...effect,
      parameters,
      animation: {
        ...defaults,
        mode: "reactive" as const,
        reactive: {
          ...defaults.reactive,
          reactivity,
          parameters: ["_HueOffset"],
        },
      },
    };
  });
}

// The Order's Margin used to be an On/Off toggle that inset the
// arrangement by its spacing. An Order saved with it On opens with its
// Margin knob at its Spacing, so it looks the same; Off opens at 0. The old
// toggle is dropped either way, so it is not saved again.
export function migrateOrderOuterMargin(effects: SessionEffect[]) {
  if (
    !effects.some(
      (effect) =>
        isOrderEffectName(effect.effectName) &&
        effect.parameters.some(
          (parameter) => parameter.key === LEGACY_OUTER_MARGIN_KEY,
        ),
    )
  ) {
    return effects;
  }

  return effects.map((effect) => {
    const old = effect.parameters.find(
      (parameter) => parameter.key === LEGACY_OUTER_MARGIN_KEY,
    );
    if (!isOrderEffectName(effect.effectName) || !old) {
      return effect;
    }

    // Read as the compositor reads it, so it opens looking the same.
    const { margin = 0 } = parseCompositionOrder(effect.parameters);
    const parameters = effect.parameters.filter(
      (parameter) => parameter !== old && parameter.key !== MARGIN_KEY,
    );
    return {
      ...effect,
      parameters: margin
        ? [
            ...parameters,
            { key: MARGIN_KEY, value: String(margin), numericValue: margin },
          ]
        : parameters,
    };
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
