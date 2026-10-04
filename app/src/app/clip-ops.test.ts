import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clipEffectTrackId, type SessionEffect } from "../fx-stack.ts";
import {
  canPasteOntoLayer,
  clipClipboardKind,
  cloneClipAtStartQ,
  duplicateClip,
  withClipStacks,
} from "./clip-ops.ts";
import type { ArrangementClip } from "./types.ts";

const clip: ArrangementClip = {
  id: "clip",
  sourceSpanId: "span",
  sourceTrackId: "track",
  laneId: "1",
  label: "Clip",
  mediaPath: "clip.mp4",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 3,
  sourceOffsetSeconds: 3,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 10,
  tint: "#000",
  accent: "#fff",
};

describe("cloneClipAtStartQ", () => {
  it("moves the clip and keeps its source frame", () => {
    const clone = cloneClipAtStartQ(clip, 120, 4, "copy");
    assert.equal(clone.id, "copy");
    assert.equal(clone.startQ, 4);
    assert.equal(clone.trimStartSeconds, 3);
    assert.equal(clone.sourceOffsetSeconds, 1);
  });
});

describe("duplicateClip", () => {
  it("places the copy right after the clip", () => {
    assert.equal(duplicateClip(clip, 120, "copy").startQ, 4);
    assert.match(duplicateClip(clip, 120).id, /^window-/);
  });
});

describe("withClipStacks", () => {
  it("keeps only the effects of the copied clips", () => {
    const own = { trackId: clipEffectTrackId("clip") } as SessionEffect;
    const other = { trackId: clipEffectTrackId("other") } as SessionEffect;
    const content = withClipStacks(
      { fragments: [{ clip }] } as Parameters<typeof withClipStacks>[0],
      [own, other],
    );
    assert.deepEqual(content.effects, [own]);
  });
});

describe("clip clipboard kinds", () => {
  const layerCopy = { fragments: [{ clip, offsetQ: 0 }], durationQ: 4 };
  const sourceCopy = {
    fragments: [],
    durationQ: 4,
    sourceSpan: {
      id: "span",
      sourceTrackId: "track",
      label: "Span",
      mediaPath: "clip.mp4",
      startQ: 0,
      durationSeconds: 2,
      trimStartSeconds: 3,
      tint: "#000",
      accent: "#fff",
    },
  };

  it("records whether content came from a layer or a source clip", () => {
    assert.equal(clipClipboardKind(layerCopy), "layer");
    assert.equal(clipClipboardKind(sourceCopy), "source");
  });

  it("pastes only layer clips onto a layer", () => {
    assert.equal(canPasteOntoLayer(layerCopy), true);
    assert.equal(canPasteOntoLayer(sourceCopy), false);
    assert.equal(canPasteOntoLayer({ fragments: [], durationQ: 0 }), false);
    assert.equal(canPasteOntoLayer(null), false);
  });
});
