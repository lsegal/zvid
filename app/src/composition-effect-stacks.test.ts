import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ActiveClip,
  type ArrangementClip,
  computeActiveClips,
  findAnimatedOrder,
  GROUP_TRACK_ID,
  type MediaItem,
  quartersToSeconds,
  resolveAnimatedOrder,
  resolveClipEffectChain,
  resolveFrameEffects,
  resolveVisualState,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { computeActiveClipTimings } from "./composition-clip-timing.ts";
import {
  clipStackEffects,
  indexEffects,
  stackEffects,
} from "./composition-effect-index.ts";
import { resolveFillPaint } from "./fill-paint.ts";
import { resolveAnimatedEffects, withPlacedOnsets } from "./fx-animation.ts";
import type { AnimationMode } from "./fx-animation-defaults.ts";
import type { AudioBands } from "./fx-shaders/audio-bands.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import { clipEffectTrackId, createEffect } from "./fx-stack.ts";
import { resolveTextStyle } from "./text-style.ts";

const BPM = 120;
const FPS = 30;
const PROJECT_DURATION_FRAMES = 20 * FPS;
const LANES = ["fx-lane", "video-lane", "text-lane", "fill-lane", "empty-lane"];
const LANE_PRIORITY = new Map(LANES.map((id, index) => [id, index]));
const MEDIA: MediaItem = {
  id: "media",
  name: "media.mp4",
  kind: "video",
  durationSeconds: 30,
  hasAudio: true,
  hasVideo: true,
  previewUrl: "/media",
};
const MEDIA_BY_ID = new Map([[MEDIA.id, MEDIA]]);
// A hit on the beat, which Reactive animations follow.
const AUDIO: AudioBands = {
  low: 0.8,
  high: 0.4,
  impulseLow: 0.9,
  impulseHigh: 0.3,
  onsets: [{ secondsAgo: 0.05, strength: 0.9 }],
};

function clip(
  id: string,
  laneId: string,
  kind?: ArrangementClip["kind"],
): ArrangementClip {
  return {
    id,
    ...(kind ? { kind } : { mediaId: MEDIA.id }),
    sourceTrackId: laneId,
    laneId,
    label: id,
    mediaPath: kind ? "" : "/media.mp4",
    startQ: 4,
    durationSeconds: 6,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 30,
    tint: "#000",
    accent: "#fff",
  };
}

const CLIPS = [
  clip("fx", "fx-lane", "fx"),
  clip("video", "video-lane"),
  clip("text", "text-lane", "text"),
  clip("fill", "fill-lane", "fill"),
];

function effect(
  trackId: string,
  effectName: string,
  id: string,
  mode?: AnimationMode,
): SessionEffect {
  const created = createEffect(trackId, effectName, id);
  return mode && created.animation
    ? { ...created, animation: { ...created.animation, enabled: true, mode } }
    : created;
}

function opacity(trackId: string, id: string, value: number): SessionEffect {
  return {
    id,
    trackId,
    effectName: "Opacity",
    parameters: [{ key: "Opacity", value: String(value), numericValue: value }],
  };
}

// Layer, Global and clip-stack effects with LFO, Reactive and Clip
// animations, interleaved, and stacks no drawn clip uses.
const EFFECTS: SessionEffect[] = [
  effect(GROUP_TRACK_ID, "Order", "global-order", "clip"),
  effect("video-lane", "Layout", "video-layout"),
  effect("video-lane", "Transform", "video-transform", "lfo"),
  opacity("video-lane", "video-opacity", 0.4),
  effect(GROUP_TRACK_ID, "Colorize", "global-colorize", "lfo"),
  opacity(GROUP_TRACK_ID, "global-opacity", 0.7),
  effect("video-lane", "Colorize", "video-colorize", "reactive"),
  effect(clipEffectTrackId("video"), "Transform", "clip-transform", "clip"),
  effect("empty-lane", "Pixelate", "unused-pixelate", "lfo"),
  effect(clipEffectTrackId("video"), "Move", "clip-move"),
  effect(clipEffectTrackId("video"), "Pixelate", "clip-pixelate", "clip"),
  effect("video-lane", "Move", "video-move"),
  effect(GROUP_TRACK_ID, "Pixelate", "global-pixelate", "reactive"),
  effect("text-lane", "Text", "layer-text"),
  effect(clipEffectTrackId("text"), "Text", "clip-text"),
  effect("text-lane", "Colorize", "text-colorize", "lfo"),
  effect("fill-lane", "Color", "layer-color"),
  effect(clipEffectTrackId("fill"), "Color", "clip-color"),
  effect(clipEffectTrackId("fill"), "Pixelate", "fill-pixelate", "lfo"),
  effect(clipEffectTrackId("fx"), "Order", "fx-order", "clip"),
  effect(clipEffectTrackId("fx"), "Pixelate", "fx-pixelate", "reactive"),
  effect(clipEffectTrackId("gone"), "Transform", "unused-transform", "clip"),
];

// Near the clips' start, in their middle and near their end.
const PLAYHEADS = [4.5, 10, 15.5];

function resolve(playheadQ: number, effects = EFFECTS) {
  return computeActiveClips(
    CLIPS,
    MEDIA_BY_ID,
    playheadQ,
    BPM,
    LANE_PRIORITY,
    effects,
    FPS,
    AUDIO,
    PROJECT_DURATION_FRAMES,
  );
}

// How each clip was resolved before #948: every session effect animated
// with the clip, then each stack picked out of the whole list.
function resolveWithAllEffects(entry: ActiveClip, playheadQ: number) {
  const { clip } = entry;
  const clipTrackId = clipEffectTrackId(clip.id);
  const effects = resolveAnimatedEffects(
    EFFECTS,
    {
      clipId: clip.id,
      laneId: clip.laneId,
      progress: entry.clipProgress,
      elapsedSeconds: quartersToSeconds(playheadQ - clip.startQ, BPM),
      durationSeconds: clip.durationSeconds,
      sessionEdges: entry.sessionEdges,
    },
    withPlacedOnsets({ playheadQ, bpm: BPM, fps: FPS, audio: AUDIO }),
  );
  const visual = resolveVisualState(
    effects,
    clip.laneId,
    clip.id,
    entry.clipProgress,
  );
  if (clip.kind === "fx") {
    const order = findAnimatedOrder(effects, clipTrackId, FPS);
    return {
      visual,
      effectChain: resolveEffectChain(effects, clipTrackId),
      ...(order ? { order } : {}),
    };
  }
  return {
    visual,
    effectChain: resolveClipEffectChain(effects, clip),
    ...(clip.kind === "text"
      ? { text: resolveTextStyle(effects, clip.laneId, clipTrackId) }
      : {}),
    ...(clip.kind === "fill"
      ? { fill: resolveFillPaint(effects, clip.laneId, clipTrackId) }
      : {}),
  };
}

function effectsOf(entry: ActiveClip) {
  const { visual, effectChain, text, fill, order } = entry;
  return {
    visual,
    effectChain,
    ...(order ? { order } : {}),
    ...(text ? { text } : {}),
    ...(fill ? { fill } : {}),
  };
}

describe("resolving each clip's own effect stacks (#948)", () => {
  it("draws every clip as resolving it with every session effect did", () => {
    for (const playheadQ of PLAYHEADS) {
      const active = resolve(playheadQ);
      assert.deepEqual(
        active.map((entry) => entry.clip.id),
        ["fx", "video", "text", "fill"],
      );
      for (const entry of active) {
        assert.deepEqual(
          effectsOf(entry),
          resolveWithAllEffects(entry, playheadQ),
          `${entry.clip.id} at ${playheadQ}`,
        );
      }
    }
  });

  it("animates the clips' effects in this session", () => {
    const [start, middle] = PLAYHEADS.map((playheadQ) =>
      resolve(playheadQ).map(effectsOf),
    );
    assert.notDeepEqual(start, middle);
  });

  it("is unchanged by effects on stacks the clip doesn't draw", () => {
    const unrelated = [
      effect("empty-lane", "Transform", "more-transform", "lfo"),
      opacity("empty-lane", "more-opacity", 0.1),
      effect(clipEffectTrackId("gone"), "Text", "more-text"),
    ];
    for (const playheadQ of PLAYHEADS) {
      assert.deepEqual(
        resolve(playheadQ, [...unrelated, ...EFFECTS, ...unrelated]),
        resolve(playheadQ),
      );
    }
  });

  it("resolves the same from an effect index as from the effects", () => {
    const index = indexEffects(EFFECTS);
    for (const playheadQ of PLAYHEADS) {
      assert.deepEqual(
        computeActiveClips(
          CLIPS,
          MEDIA_BY_ID,
          playheadQ,
          BPM,
          LANE_PRIORITY,
          index,
          FPS,
          AUDIO,
          PROJECT_DURATION_FRAMES,
        ),
        resolve(playheadQ),
      );
    }
  });

  it("times the clips for media sync as the drawn clips are timed", () => {
    for (const playheadQ of PLAYHEADS) {
      assert.deepEqual(
        computeActiveClipTimings(
          CLIPS,
          MEDIA_BY_ID,
          playheadQ,
          BPM,
          LANE_PRIORITY,
        ),
        resolve(playheadQ).map(
          ({
            clip,
            media,
            sourceKey,
            mediaTime,
            playbackRate,
            isInBounds,
            laneRank,
          }) => ({
            clip,
            media,
            sourceKey,
            mediaTime,
            playbackRate,
            isInBounds,
            laneRank,
          }),
        ),
      );
    }
  });

  it("draws the Global chain and Order from the Global stack alone", () => {
    const global = stackEffects(indexEffects(EFFECTS), GROUP_TRACK_ID);
    for (const playheadQ of PLAYHEADS) {
      const active = resolve(playheadQ);
      const all = resolveFrameEffects(EFFECTS, active, playheadQ, BPM, FPS);
      const own = resolveFrameEffects(global, active, playheadQ, BPM, FPS);
      assert.deepEqual(
        resolveEffectChain(own, GROUP_TRACK_ID),
        resolveEffectChain(all, GROUP_TRACK_ID),
      );
      assert.deepEqual(
        resolveAnimatedOrder(own, GROUP_TRACK_ID, FPS),
        resolveAnimatedOrder(all, GROUP_TRACK_ID, FPS),
      );
    }
  });
});

describe("indexEffects", () => {
  it("groups the effects by stack in session order", () => {
    const index = indexEffects(EFFECTS);
    assert.deepEqual(
      stackEffects(index, GROUP_TRACK_ID).map((entry) => entry.id),
      ["global-order", "global-colorize", "global-opacity", "global-pixelate"],
    );
    assert.deepEqual(stackEffects(index, "missing"), []);
  });

  it("lists a clip's Global and layer stacks in session order, then its own", () => {
    const index = indexEffects(EFFECTS);
    assert.deepEqual(
      clipStackEffects(index, "video-lane", clipEffectTrackId("video")).map(
        (entry) => entry.id,
      ),
      [
        "global-order",
        "video-layout",
        "video-transform",
        "video-opacity",
        "global-colorize",
        "global-opacity",
        "video-colorize",
        "video-move",
        "global-pixelate",
        "clip-transform",
        "clip-move",
        "clip-pixelate",
      ],
    );
  });

  it("finds a layer's stacks once for all its clips", () => {
    const index = indexEffects(EFFECTS);
    const layer = clipStackEffects(index, "text-lane", "clip:none");
    assert.equal(clipStackEffects(index, "text-lane", "clip:other"), layer);
  });
});
