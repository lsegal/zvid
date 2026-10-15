import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ArrangementClip,
  Lane,
  SourceSpan,
  SourceTrack,
} from "./app/types.ts";
import {
  computeActiveClips,
  type MediaItem,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { indexEffects } from "./composition-effect-index.ts";
import { sourceStackEffects } from "./composition-source-effects.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./fx/stack/clip-stacks.ts";
import { createEffect } from "./fx/stack/ops.ts";
import { resolveRenderClips } from "./render-clips.ts";

// At 120 BPM one quarter is half a second.
const BPM = 120;
const LANES: Lane[] = [{ id: "1", name: "Layer 1", colorIndex: 0 }];
const MEDIA = new Map<string, MediaItem>([
  [
    "media-a",
    {
      id: "media-a",
      name: "a.mp4",
      kind: "video",
      durationSeconds: 60,
      hasAudio: true,
      hasVideo: true,
      previewUrl: "/a",
    },
  ],
]);

function track(fxEnabled?: boolean): SourceTrack {
  return {
    id: "a",
    name: "Track a",
    colorIndex: 0,
    recordingPaths: [],
    ...(fxEnabled === undefined ? {} : { fxEnabled }),
  };
}

function span(id: string, startQ: number, durationSeconds: number): SourceSpan {
  return {
    id,
    sourceTrackId: "a",
    label: `Span ${id}`,
    mediaPath: "a.mp4",
    mediaId: "media-a",
    startQ,
    durationSeconds,
    trimStartSeconds: 0,
    tint: "#000",
    accent: "#fff",
  };
}

// A layer clip of `durationSeconds` at `startQ` showing source track "a"
// `slipSeconds` after its own position.
function layerClip(
  startQ: number,
  durationSeconds: number,
  slipSeconds = 0,
): ArrangementClip {
  const startSeconds = startQ / 2;
  return {
    id: "clip-1",
    sourceSpanId: "a-1",
    sourceTrackId: "a",
    laneId: "1",
    label: "Clip",
    mediaPath: "a.mp4",
    mediaId: "media-a",
    startQ,
    durationSeconds,
    trimStartSeconds: startSeconds + slipSeconds,
    sourceOffsetSeconds: slipSeconds,
    sourceSpanOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 8,
    tint: "#000",
    accent: "#fff",
  };
}

function colorize(id: string, trackId: string, hue: number): SessionEffect {
  const effect = createEffect(trackId, "Colorize", id);
  return {
    ...effect,
    parameters: effect.parameters.map((parameter) =>
      parameter.key === "_HueOffset"
        ? { ...parameter, value: String(hue), numericValue: hue }
        : parameter,
    ),
  };
}

// `effect` with a free-running LFO swinging its hue.
function withLfo(effect: SessionEffect): SessionEffect {
  const animation = effect.animation;
  assert.ok(animation?.lfo);
  return {
    ...effect,
    animation: {
      ...animation,
      enabled: true,
      mode: "lfo",
      lfo: {
        ...animation.lfo,
        sync: false,
        rate: 0.3,
        depth: 1,
        parameters: ["_HueOffset"],
      },
    },
  };
}

function render(
  clips: ArrangementClip[],
  spans: SourceSpan[],
  effects: SessionEffect[],
  playheadQ: number,
  sourceTrack = track(),
) {
  const rendered = resolveRenderClips({
    clips,
    lanes: LANES,
    sourceTracks: [sourceTrack],
    sourceSpans: spans,
    bpm: BPM,
    effects,
  });
  return computeActiveClips(
    rendered.clips,
    MEDIA,
    playheadQ,
    BPM,
    new Map(rendered.lanes.map((lane, index) => [lane.id, index])),
    rendered.effects,
    30,
    undefined,
    // Long enough that no clip ends with the session.
    9000,
  );
}

function chainHues(clip: { effectChain: { parameters: unknown }[] }) {
  return clip.effectChain.map((step) => {
    const parameters = step.parameters as SessionEffect["parameters"];
    return parameters.find((parameter) => parameter.key === "_HueOffset")
      ?.numericValue;
  });
}

describe("layer clips inherit their source's effects", () => {
  it("runs the source clip's chain ahead of the clip's own, then the layer's", () => {
    const [active] = render(
      [layerClip(0, 2)],
      [span("a-1", 0, 8)],
      [
        colorize("layer", "1", 10),
        colorize("own", clipEffectTrackId("clip-1"), -90),
        colorize("source", sourceClipEffectTrackId("a-1"), 90),
        colorize("track", sourceTrackEffectTrackId("a"), 5),
      ],
      1,
    );

    // Source track, source clip, the clip's own, then the layer's.
    assert.deepEqual(chainHues(active), [5, 90, -90, 10]);
  });

  it("reads the source stacks at render time, so editing them changes every layer clip", () => {
    const effects = [colorize("source", sourceClipEffectTrackId("a-1"), 90)];
    const before = render([layerClip(0, 2)], [span("a-1", 0, 8)], effects, 1);
    const after = render(
      [layerClip(0, 2)],
      [span("a-1", 0, 8)],
      [colorize("source", sourceClipEffectTrackId("a-1"), 45)],
      1,
    );
    const deleted = render([layerClip(0, 2)], [span("a-1", 0, 8)], [], 1);

    assert.deepEqual(chainHues(before[0]), [90]);
    assert.deepEqual(chainHues(after[0]), [45]);
    assert.deepEqual(chainHues(deleted[0]), []);
  });

  it("gives each piece of a clip over several source clips the stack of the one it shows", () => {
    const active = (playheadQ: number) =>
      render(
        [layerClip(0, 4)],
        [span("a-1", 0, 2), span("a-2", 4, 2)],
        [
          colorize("first", sourceClipEffectTrackId("a-1"), 30),
          colorize("second", sourceClipEffectTrackId("a-2"), 60),
        ],
        playheadQ,
      )[0];

    assert.deepEqual(chainHues(active(1)), [30]);
    assert.deepEqual(chainHues(active(5)), [60]);
  });

  it("animates inherited effects on the source's time, so a slipped clip follows its media", () => {
    const spans = [span("a-1", 0, 8)];
    const effects = [
      withLfo(colorize("source", sourceClipEffectTrackId("a-1"), 0)),
    ];
    // The source rendered in place, 3 s in.
    const inPlace = render([], spans, effects, 6)[0];
    // A layer clip at 1 s showing the track 2 s later: at 1 s it shows the
    // media the source plays at 3 s.
    const slipped = render([layerClip(2, 4, 2)], spans, effects, 2)[0];
    // Unslipped at the same playhead, it shows the media at 1 s.
    const unslipped = render([layerClip(0, 4)], spans, effects, 2)[0];

    const [inPlaceHue] = chainHues(inPlace);
    assert.notEqual(inPlaceHue, 0);
    assert.deepEqual(chainHues(slipped), [inPlaceHue]);
    assert.notDeepEqual(chainHues(unslipped), [inPlaceHue]);
  });

  it("renders a session with no layer clips as before, with each source stack applied once", () => {
    const [active] = render(
      [],
      [span("a-1", 0, 8)],
      [
        colorize("track", sourceTrackEffectTrackId("a"), 5),
        colorize("source", sourceClipEffectTrackId("a-1"), 90),
      ],
      1,
    );

    // The source clip's chain, then its track's, as for a clip and layer.
    assert.deepEqual(chainHues(active), [90, 5]);
  });

  it("inherits nothing from a source track whose FX are off", () => {
    const [active] = render(
      [layerClip(0, 2)],
      [span("a-1", 0, 8)],
      [
        colorize("track", sourceTrackEffectTrackId("a"), 5),
        colorize("source", sourceClipEffectTrackId("a-1"), 90),
        colorize("own", clipEffectTrackId("clip-1"), -90),
      ],
      1,
      track(false),
    );

    assert.deepEqual(chainHues(active), [-90]);
  });

  it("leaves fill, text and FX clips without a source stack", () => {
    const fill: ArrangementClip = { ...layerClip(0, 2), kind: "fill" };
    const [active] = render(
      [fill],
      [span("a-1", 0, 8)],
      [colorize("source", sourceClipEffectTrackId("a-1"), 90)],
      1,
    );

    assert.deepEqual(chainHues(active), []);
  });
});

describe("sourceStackEffects", () => {
  it("lists the source track's stack, then the source clip's", () => {
    const index = indexEffects([
      colorize("clip", sourceClipEffectTrackId("a-1"), 1),
      colorize("global", GLOBAL_EFFECT_TRACK_ID, 2),
      colorize("track", sourceTrackEffectTrackId("a"), 3),
      colorize("other", sourceClipEffectTrackId("a-2"), 4),
    ]);

    assert.deepEqual(
      sourceStackEffects(index, "a", "a-1").map((effect) => effect.id),
      ["track", "clip"],
    );
    assert.deepEqual(
      sourceStackEffects(index, "a", undefined).map((effect) => effect.id),
      ["track"],
    );
  });
});
