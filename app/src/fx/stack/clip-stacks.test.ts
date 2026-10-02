import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipEffectTrackId,
  copyClipEffects,
  copyEffectStacks,
  GLOBAL_EFFECT_TRACK_ID,
  getEffectClipId,
  getEffectSourceSpanId,
  getEffectSourceTrackId,
  getTrackGroup,
  previewDuplicateClipEffects,
  pruneClipEffects,
  pruneSourceEffects,
  renameClipEffectTracks,
  renameSourceClipEffectTracks,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "./clip-stacks.ts";
import { addEffect, createEffect, removeEffect } from "./ops.ts";

import type { SessionEffect } from "./types.ts";

describe("clip stacks", () => {
  const clipTrack = clipEffectTrackId("clip-1");

  it("keys a clip's stack by its clip id", () => {
    assert.equal(clipTrack, "clip:clip-1");
    assert.equal(getEffectClipId(clipTrack), "clip-1");
    assert.equal(getEffectClipId("6"), undefined);
    assert.equal(getEffectClipId(GLOBAL_EFFECT_TRACK_ID), undefined);
    assert.equal(getTrackGroup(clipTrack), "clip");
    assert.equal(getTrackGroup("6"), "layer");
    assert.equal(getTrackGroup(GLOBAL_EFFECT_TRACK_ID), "global");
  });

  it("takes Transform and visual effects, but not Layout or Order", () => {
    let effects: SessionEffect[] = [];
    for (const name of ["Transform", "Colorize", "Pixelate", "ZoomAndPan"]) {
      effects = addEffect(effects, clipTrack, name, undefined, name);
    }
    assert.deepEqual(
      effects.map((effect) => [effect.trackId, effect.effectName]),
      [
        [clipTrack, "Transform"],
        [clipTrack, "Colorize"],
        [clipTrack, "Pixelate"],
        [clipTrack, "ZoomAndPan"],
      ],
    );
    assert.equal(addEffect(effects, clipTrack, "Layout"), effects);
    assert.equal(addEffect(effects, clipTrack, "Order"), effects);
    // Transform stays off the Global stack.
    assert.equal(
      addEffect(effects, GLOBAL_EFFECT_TRACK_ID, "Transform"),
      effects,
    );
  });

  it("never treats a clip's Layout as its layer's own", () => {
    const layout = createEffect(clipTrack, "Layout", "clip-layout");
    // A clip Layout from elsewhere can still be removed.
    assert.deepEqual(removeEffect([layout], "clip-layout"), []);
  });

  it("copies a clip's stack to its copies under new ids", () => {
    const transform = createEffect(clipTrack, "Transform", "t");
    const colorize = createEffect(clipTrack, "Colorize", "c");
    const layer = createEffect("6", "Pixelate", "p");
    const effects = [transform, layer, colorize];
    let next = 0;
    const copied = copyClipEffects(
      effects,
      [["clip-1", "clip-2"]],
      effects,
      () => `copy-${++next}`,
    );
    assert.deepEqual(
      copied.map((effect) => [effect.id, effect.trackId, effect.effectName]),
      [
        ["t", clipTrack, "Transform"],
        ["p", "6", "Pixelate"],
        ["c", clipTrack, "Colorize"],
        ["copy-1", "clip:clip-2", "Transform"],
        ["copy-2", "clip:clip-2", "Colorize"],
      ],
    );
    // Parameters are copies, not shared.
    assert.notEqual(copied[3].parameters[0], transform.parameters[0]);
    assert.deepEqual(copied[3].parameters, transform.parameters);
  });

  it("copies from a snapshot, replacing the copy's own stack", () => {
    const snapshot = [createEffect(clipTrack, "Colorize", "c")];
    const stale = createEffect("clip:clip-2", "Pixelate", "stale");
    const copied = copyClipEffects(
      [stale],
      [["clip-1", "clip-2"]],
      snapshot,
      () => "copy",
    );
    assert.deepEqual(
      copied.map((effect) => [effect.id, effect.effectName]),
      [["copy", "Colorize"]],
    );
  });

  it("leaves effects alone when the source clip has no stack", () => {
    const effects = [createEffect("6", "Pixelate", "p")];
    assert.equal(copyClipEffects(effects, [["clip-1", "clip-2"]]), effects);
  });

  it("previews a duplicate's stack without touching the effects", () => {
    const transform = createEffect(clipTrack, "Transform", "t");
    const effects = [transform, createEffect("6", "Pixelate", "p")];
    const snapshot = structuredClone(effects);
    const preview = previewDuplicateClipEffects(effects, "clip-1", "clip-2");
    assert.deepEqual(
      preview.map((effect) => [effect.id, effect.trackId, effect.effectName]),
      [
        ["t", clipTrack, "Transform"],
        ["p", "6", "Pixelate"],
        ["clip:clip-2:preview-1", "clip:clip-2", "Transform"],
      ],
    );
    assert.deepEqual(preview[2].parameters, transform.parameters);
    // Nothing is written back, so canceling the drag leaves no stack.
    assert.deepEqual(effects, snapshot);
    // Redrawing the drag gives the same ids.
    assert.deepEqual(
      previewDuplicateClipEffects(effects, "clip-1", "clip-2"),
      preview,
    );
    assert.equal(
      previewDuplicateClipEffects(effects, "clip-3", "clip-4"),
      effects,
    );
  });

  it("drops the stacks of clips that are gone", () => {
    const effects = [
      createEffect("clip:kept", "Transform", "kept"),
      createEffect("clip:gone", "Transform", "gone"),
      createEffect("6", "Pixelate", "layer"),
      createEffect(GLOBAL_EFFECT_TRACK_ID, "Order", "order"),
    ];
    assert.deepEqual(
      pruneClipEffects(effects, [{ id: "kept" }]).map((effect) => effect.id),
      ["kept", "layer", "order"],
    );
    const unchanged = pruneClipEffects(effects, [
      { id: "kept" },
      { id: "gone" },
    ]);
    assert.equal(unchanged, effects);
  });

  it("renames clip stacks to the ids their clips are saved under", () => {
    const effects = [
      createEffect("clip:window-a", "Transform", "a"),
      createEffect("clip:fill-b", "Colorize", "b"),
      createEffect("6", "Pixelate", "layer"),
    ];
    assert.deepEqual(
      renameClipEffectTracks(
        effects,
        new Map([["window-a", "selection-3"]]),
      ).map((effect) => effect.trackId),
      ["clip:selection-3", "clip:fill-b", "6"],
    );
  });
});

describe("source track and source clip stacks", () => {
  const trackStack = sourceTrackEffectTrackId("track-1");
  const spanStack = sourceClipEffectTrackId("span-1");

  it("keys them by source track and span id, apart from layers and clips", () => {
    assert.equal(trackStack, "source-track:track-1");
    assert.equal(spanStack, "source-clip:span-1");
    assert.equal(getEffectSourceTrackId(trackStack), "track-1");
    assert.equal(getEffectSourceSpanId(spanStack), "span-1");
    assert.equal(getEffectSourceTrackId(spanStack), undefined);
    assert.equal(getEffectSourceSpanId(trackStack), undefined);
    assert.equal(getEffectSourceTrackId("track-1"), undefined);
    assert.equal(getEffectSourceSpanId(clipEffectTrackId("span-1")), undefined);
    // Neither is an arrangement clip's stack.
    assert.equal(getEffectClipId(trackStack), undefined);
    assert.equal(getEffectClipId(spanStack), undefined);
    // A source track's stack is track-level and a source clip's clip-level.
    assert.equal(getTrackGroup(trackStack), "layer");
    assert.equal(getTrackGroup(spanStack), "clip");
  });

  it("offers a source track the layer's effects and a source clip the clip's", () => {
    let effects: SessionEffect[] = [];
    for (const name of ["Transform", "Colorize", "Order"]) {
      effects = addEffect(effects, trackStack, name, undefined, `t-${name}`);
      effects = addEffect(effects, spanStack, name, undefined, `s-${name}`);
    }
    assert.deepEqual(
      effects.map((effect) => effect.id),
      ["t-Transform", "t-Colorize", "s-Transform", "s-Colorize"],
    );
  });

  it("is not pruned with arrangement clips", () => {
    const effects = [
      createEffect(trackStack, "Colorize", "track"),
      createEffect(spanStack, "Colorize", "span"),
    ];
    assert.equal(pruneClipEffects(effects, []), effects);
  });

  it("drops the stacks of source tracks and clips that are gone", () => {
    const effects = [
      createEffect(GLOBAL_EFFECT_TRACK_ID, "Colorize", "global"),
      createEffect(trackStack, "Colorize", "track"),
      createEffect(sourceTrackEffectTrackId("gone"), "Colorize", "gone-track"),
      createEffect(spanStack, "Colorize", "span"),
      createEffect(sourceClipEffectTrackId("gone"), "Colorize", "gone-span"),
      createEffect(clipEffectTrackId("gone"), "Colorize", "clip"),
    ];
    assert.deepEqual(
      pruneSourceEffects(effects, [{ id: "track-1" }], [{ id: "span-1" }]).map(
        (effect) => effect.id,
      ),
      ["global", "track", "span", "clip"],
    );
    const kept = effects.filter((effect) => !effect.id.startsWith("gone"));
    assert.equal(
      pruneSourceEffects(kept, [{ id: "track-1" }], [{ id: "span-1" }]),
      kept,
    );
  });

  it("copies a stack to another with new effect ids", () => {
    const effects = [
      createEffect(trackStack, "Colorize", "a"),
      createEffect(trackStack, "Pixelate", "b"),
    ];
    let next = 0;
    const copied = copyEffectStacks(
      effects,
      [[trackStack, sourceTrackEffectTrackId("copy")]],
      effects,
      () => `new-${++next}`,
    );
    assert.deepEqual(
      copied.map((effect) => [effect.id, effect.trackId, effect.effectName]),
      [
        ["a", trackStack, "Colorize"],
        ["b", trackStack, "Pixelate"],
        ["new-1", sourceTrackEffectTrackId("copy"), "Colorize"],
        ["new-2", sourceTrackEffectTrackId("copy"), "Pixelate"],
      ],
    );
    assert.equal(
      copyEffectStacks(effects, [[spanStack, sourceClipEffectTrackId("x")]]),
      effects,
    );
  });

  it("renames source clip stacks to their spans' new ids", () => {
    const effects = [
      createEffect(spanStack, "Colorize", "span"),
      createEffect(trackStack, "Colorize", "track"),
      createEffect(clipEffectTrackId("span-1"), "Colorize", "clip"),
    ];
    assert.deepEqual(
      renameSourceClipEffectTracks(
        effects,
        new Map([["span-1", "source-span-1"]]),
      ).map((effect) => effect.trackId),
      [
        sourceClipEffectTrackId("source-span-1"),
        trackStack,
        clipEffectTrackId("span-1"),
      ],
    );
  });
});
