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
  GROUP_TRACK_ID,
  type MediaItem,
  resolveFrameEffects,
  type SessionEffect,
} from "./composition-active-clips.ts";
import {
  orderStackedLayers,
  resolveLayerPlacement,
} from "./composition-layout.ts";
import { getCompositionEndQ } from "./composition-progress.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import {
  clipEffectTrackId,
  getRenderedEffects,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./fx-stack.ts";
import {
  hasRenderableContent,
  isSourceRenderId,
  resolveRenderClips,
  resolveRenderEffects,
  sourceRenderClipId,
  sourceRenderLaneId,
} from "./render-clips.ts";

// At 120 BPM one quarter is half a second.
const BPM = 120;

function track(id: string, colorIndex = 0): SourceTrack {
  return { id, name: `Track ${id}`, colorIndex, recordingPaths: [] };
}

function span(
  id: string,
  sourceTrackId: string,
  startQ: number,
  durationSeconds: number,
  trimStartSeconds = 0,
): SourceSpan {
  return {
    id,
    sourceTrackId,
    label: `Span ${id}`,
    mediaPath: `${sourceTrackId}.mp4`,
    mediaId: `media-${sourceTrackId}`,
    startQ,
    durationSeconds,
    trimStartSeconds,
    tint: "#000",
    accent: "#fff",
  };
}

function media(id: string): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    durationSeconds: 60,
    width: 1080,
    height: 1920,
    hasAudio: true,
    hasVideo: true,
    previewUrl: `/${id}`,
  };
}

const LANES: Lane[] = [{ id: "1", name: "Layer 1", colorIndex: 0 }];
// Stored in a non-alphabetical order, so order follows the list, not ids.
const TRACKS = [track("b", 3), track("a", 5)];
const SPANS = [
  span("a-1", "a", 0, 4, 2),
  span("b-1", "b", 2, 6, 1),
  span("b-2", "b", 16, 2),
];
const MEDIA = new Map(
  ["media-a", "media-b"].map((id) => [id, media(id)] as const),
);

const LAYER_CLIP: ArrangementClip = {
  id: "selection-1",
  sourceSpanId: "a-1",
  sourceTrackId: "a",
  laneId: "1",
  label: "Clip",
  mediaPath: "a.mp4",
  mediaId: "media-a",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 2,
  tint: "#000",
  accent: "#fff",
};

function fallback(
  spans = SPANS,
  tracks = TRACKS,
  effects: SessionEffect[] = [],
) {
  return resolveRenderClips({
    clips: [],
    lanes: LANES,
    sourceTracks: tracks,
    sourceSpans: spans,
    bpm: BPM,
    effects,
  });
}

function effect(
  id: string,
  trackId: string,
  effectName: string,
): SessionEffect {
  return { id, trackId, effectName, parameters: [] };
}

function priorityOf(lanes: Lane[]) {
  return new Map(lanes.map((lane, index) => [lane.id, index]));
}

describe("resolveRenderClips", () => {
  it("passes the arrangement through once it has any layer clip", () => {
    const clips = [LAYER_CLIP];
    const effects = [
      effect("track", sourceTrackEffectTrackId("a"), "AnalogGlitch"),
    ];
    const render = resolveRenderClips({
      clips,
      lanes: LANES,
      sourceTracks: TRACKS,
      sourceSpans: SPANS,
      bpm: BPM,
      effects,
    });
    assert.equal(render.clips, clips);
    assert.equal(render.lanes, LANES);
    assert.equal(render.effects, effects);
    assert.equal(render.fromSourceTracks, false);
  });

  it("passes an empty arrangement through without source spans", () => {
    const render = fallback([]);
    assert.deepEqual(render.clips, []);
    assert.equal(render.lanes, LANES);
    assert.equal(render.fromSourceTracks, false);
  });

  it("renders one layer per source track, in source track order", () => {
    const render = fallback();
    assert.equal(render.fromSourceTracks, true);
    assert.deepEqual(
      render.lanes.map((lane) => [lane.id, lane.name, lane.colorIndex]),
      [
        ["source-render:b", "Track b", 3],
        ["source-render:a", "Track a", 5],
      ],
    );
    assert.ok(render.lanes.every((lane) => lane.fxEnabled === undefined));
  });

  it("turns each span into a clip playing its media at its position", () => {
    const render = fallback();
    assert.deepEqual(
      render.clips.map((clip) => [clip.id, clip.laneId, clip.sourceSpanId]),
      [
        ["source-render:a-1", "source-render:a", "a-1"],
        ["source-render:b-1", "source-render:b", "b-1"],
        ["source-render:b-2", "source-render:b", "b-2"],
      ],
    );
    const clip = render.clips[1];
    assert.equal(clip.startQ, 2);
    assert.equal(clip.durationSeconds, 6);
    assert.equal(clip.trimStartSeconds, 1);
    assert.equal(clip.mediaId, "media-b");
    assert.equal(clip.kind, undefined);
    // Quarter 2 is 1s into the timeline, where the span plays 1s in.
    assert.equal(clip.sourceOffsetSeconds, 0);
    assert.equal(clip.sourceWindowStartSeconds, 1);
    assert.equal(clip.sourceWindowEndSeconds, 7);
  });

  it("keeps a span's warp", () => {
    const warp = {
      markers: [
        { beatTime: 0, secTime: 0 },
        { beatTime: 4, secTime: 1 },
      ],
      contentStartBeat: 0,
      anchorSeconds: 0,
    };
    const render = fallback([{ ...span("w", "a", 0, 1), warp }]);
    assert.equal(render.clips[0].warp, warp);
  });

  it("namespaces virtual ids", () => {
    assert.equal(sourceRenderLaneId("a"), "source-render:a");
    assert.equal(sourceRenderClipId("a-1"), "source-render:a-1");
    assert.ok(isSourceRenderId("source-render:a"));
    assert.ok(!isSourceRenderId("1"));
    assert.ok(!isSourceRenderId(LAYER_CLIP.id));
  });

  it("renders spans on an unlisted track below the listed tracks", () => {
    const render = fallback([...SPANS, span("c-1", "c", 0, 1)]);
    assert.deepEqual(
      render.lanes.map((lane) => lane.id),
      ["source-render:b", "source-render:a", "source-render:c"],
    );
  });

  it("moves source track and clip stacks onto the virtual ids", () => {
    const effects = [
      effect("global", GROUP_TRACK_ID, "Pixelate"),
      effect("track", sourceTrackEffectTrackId("a"), "AnalogGlitch"),
      effect("span", sourceClipEffectTrackId("a-1"), "Colorize"),
      effect("layer", "1", "Colorize"),
    ];
    assert.deepEqual(
      fallback(SPANS, TRACKS, effects).effects.map((entry) => [
        entry.id,
        entry.trackId,
      ]),
      [
        ["global", GROUP_TRACK_ID],
        ["track", "source-render:a"],
        ["span", clipEffectTrackId("source-render:a-1")],
        ["layer", "1"],
      ],
    );
    // Without source stacks the effects pass through as they are.
    const plain = [effects[0], effects[3]];
    assert.equal(resolveRenderEffects(plain), plain);
  });

  it("ends the session with the last span", () => {
    // b-2 ends at quarter 16 + 2s = quarter 20.
    assert.equal(getCompositionEndQ(fallback().clips, BPM), 20);
  });
});

describe("hasRenderableContent", () => {
  it("needs a layer clip or a source span", () => {
    assert.equal(hasRenderableContent({ clips: [], sourceSpans: [] }), false);
    assert.equal(hasRenderableContent({ clips: [], sourceSpans: SPANS }), true);
    assert.equal(
      hasRenderableContent({ clips: [LAYER_CLIP], sourceSpans: [] }),
      true,
    );
  });
});

describe("source tracks rendered as layers", () => {
  function activeAt(playheadQ: number, effects: SessionEffect[] = []) {
    const render = fallback(SPANS, TRACKS, effects);
    return computeActiveClips(
      render.clips,
      MEDIA,
      playheadQ,
      BPM,
      priorityOf(render.lanes),
      getRenderedEffects(render.effects, render.lanes, render.clips),
    );
  }

  it("stacks one slot per active source track under the default Order", () => {
    // At quarter 3, a-1 and b-1 both play; source track b is listed first.
    const stacked = orderStackedLayers(activeAt(3));
    assert.deepEqual(
      stacked.map((entry) => entry.clip.id),
      ["source-render:b-1", "source-render:a-1"],
    );
    const [top, bottom] = stacked.map((entry, index) =>
      resolveLayerPlacement({
        index,
        count: stacked.length,
        canvasWidth: 1080,
        canvasHeight: 1920,
        sourceWidth: 1080,
        sourceHeight: 1920,
        visual: entry.visual,
      }),
    );
    assert.equal(top.scissor.y, 960, "Source track 1 fills the top half");
    assert.equal(bottom.scissor.y, 0, "Source track 2 fills the bottom half");
  });

  it("plays each span's media at its timeline position", () => {
    // Quarter 3 is 1.5s in: 1.5s into a-1 (trim 2s) and 0.5s into b-1
    // (trim 1s).
    const byId = new Map(activeAt(3).map((entry) => [entry.clip.id, entry]));
    assert.equal(byId.get("source-render:a-1")?.mediaTime, 3.5);
    assert.equal(byId.get("source-render:b-1")?.mediaTime, 1.5);
  });

  it("applies Global, then each source track's and source clip's stacks", () => {
    // Stacks stored for real layers and clips, and under the source tracks'
    // and spans' bare ids, never reach the virtual layers.
    const effects = [
      effect("global", GROUP_TRACK_ID, "Pixelate"),
      effect("layer", "1", "Colorize"),
      effect("track", "a", "Colorize"),
      effect("clip", clipEffectTrackId(LAYER_CLIP.id), "Colorize"),
      effect("span", clipEffectTrackId("a-1"), "Colorize"),
      effect("track-a", sourceTrackEffectTrackId("a"), "AnalogGlitch"),
      effect("clip-a-1", sourceClipEffectTrackId("a-1"), "NegativeSplit"),
      effect("clip-b-2", sourceClipEffectTrackId("b-2"), "Colorize"),
    ];
    const active = activeAt(3, effects);
    assert.equal(active.length, 2);
    const chains = new Map(
      active.map((entry) => [
        entry.clip.id,
        entry.effectChain.map((step) => step.pass.effectName),
      ]),
    );
    // A clip's own stack runs on its pixels before its track's, as on a
    // layer; b-1 has no stacks of its own or on its track.
    assert.deepEqual(chains.get("source-render:a-1"), [
      "NegativeSplit",
      "AnalogGlitch",
    ]);
    assert.deepEqual(chains.get("source-render:b-1"), []);
    const composite = resolveEffectChain(
      resolveFrameEffects(effects, active, 3, BPM),
      GROUP_TRACK_ID,
    );
    assert.deepEqual(
      composite.map((step) => step.pass.effectName),
      ["Pixelate"],
    );
  });
});
