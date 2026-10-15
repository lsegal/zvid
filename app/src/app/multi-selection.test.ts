import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_PROJECT_STATE } from "./constants.ts";
import {
  copyMultiSelection,
  dedupeSelectionItems,
  describeMultiSelection,
  isMultiClipboard,
  pasteMultiClipboard,
  removeMultiSelection,
  type SelectionItem,
  toggleSelectionItem,
} from "./multi-selection.ts";
import type {
  ArrangementClip,
  ProjectState,
  SourceSpan,
  SourceTrack,
} from "./types.ts";

// At 120 BPM a quarter lasts half a second.
const BPM = 120;

function fillClip(id: string, laneId: string, startQ: number): ArrangementClip {
  return {
    id,
    kind: "fill",
    sourceSpanId: "",
    sourceTrackId: "",
    laneId,
    label: `Clip ${id}`,
    mediaPath: "",
    startQ,
    durationSeconds: 1,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 0,
    tint: "tint",
    accent: "accent",
  };
}

function span(id: string, trackId: string, startQ: number): SourceSpan {
  return {
    id,
    sourceTrackId: trackId,
    label: `Span ${id}`,
    mediaPath: "m1.mp4",
    mediaId: "m1",
    startQ,
    durationSeconds: 2,
    trimStartSeconds: 0,
    tint: "tint",
    accent: "accent",
  };
}

function track(id: string): SourceTrack {
  return { id, name: id, colorIndex: 0, recordingPaths: ["m1.mp4"] };
}

function project(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    ...INITIAL_PROJECT_STATE,
    bpm: BPM,
    lanes: [
      { id: "l1", name: "Layer 1", colorIndex: -1 },
      { id: "l2", name: "Layer 2", colorIndex: -1 },
      { id: "l3", name: "Layer 3", colorIndex: -1 },
    ],
    sourceTracks: [track("t1"), track("t2")],
    effects: [],
    ...overrides,
  };
}

const ids = (prefix: string) => {
  let next = 0;
  return (kind: SelectionItem["kind"]) => `${prefix}-${kind}-${next++}`;
};

describe("selection items", () => {
  const a: SelectionItem = { kind: "clip", id: "a" };
  const b: SelectionItem = { kind: "span", id: "b", sourceTrackId: "t1" };

  it("adds an item last, making it the primary one", () => {
    assert.deepEqual(toggleSelectionItem([a], b), [a, b]);
  });

  it("takes out an item already selected", () => {
    assert.deepEqual(toggleSelectionItem([a, b], a), [b]);
  });

  it("tells a clip and a source clip with the same id apart", () => {
    const clip: SelectionItem = { kind: "clip", id: "b" };
    assert.deepEqual(toggleSelectionItem([b], clip), [b, clip]);
  });

  it("keeps each item once, at its last position", () => {
    assert.deepEqual(dedupeSelectionItems([a, b, a]), [b, a]);
  });

  it("describes the selection for the status bar", () => {
    assert.equal(describeMultiSelection(3), "3 clips selected");
  });
});

describe("copyMultiSelection", () => {
  it("places every clip and source clip relative to the earliest", () => {
    const clipboard = copyMultiSelection(
      {
        clips: [fillClip("c2", "l2", 6), fillClip("c1", "l1", 4)],
        spans: [span("s1", "t1", 5)],
      },
      BPM,
      [
        { trackId: "clip:c1", id: "e1" },
        { trackId: "source-clip:s1", id: "e2" },
        { trackId: "clip:other", id: "e3" },
      ] as ProjectState["effects"],
    );
    assert.ok(isMultiClipboard(clipboard));
    assert.deepEqual(
      clipboard.fragments.map(({ clip, offsetQ }) => [clip.id, offsetQ]),
      [
        ["c1", 0],
        ["c2", 2],
      ],
    );
    assert.deepEqual(
      clipboard.sourceFragments?.map(({ span, offsetQ }) => [span.id, offsetQ]),
      [["s1", 1]],
    );
    // From quarter 4 to the source clip's end at 5 + 4.
    assert.equal(clipboard.durationQ, 5);
    assert.deepEqual(
      clipboard.effects?.map((effect) => effect.id),
      ["e1", "e2"],
    );
  });

  it("leaves a single clip's clipboard as it was", () => {
    assert.equal(isMultiClipboard({ fragments: [], durationQ: 0 }), false);
  });
});

describe("removeMultiSelection", () => {
  it("removes the selected clips and source clips only", () => {
    const current = project({
      clips: [fillClip("c1", "l1", 0), fillClip("c2", "l2", 0)],
      sourceSpans: [span("s1", "t1", 0), span("s2", "t2", 0)],
    });
    const next = removeMultiSelection(
      current,
      new Set(["c1"]),
      new Set(["s2"]),
    );
    assert.deepEqual(
      next.clips.map((clip) => clip.id),
      ["c2"],
    );
    assert.deepEqual(
      next.sourceSpans.map((item) => item.id),
      ["s1"],
    );
  });
});

describe("pasteMultiClipboard", () => {
  const clipboard = copyMultiSelection(
    {
      clips: [fillClip("c1", "l1", 4), fillClip("c2", "l2", 6)],
      spans: [span("s1", "t1", 5)],
    },
    BPM,
  );

  it("pastes each kind back onto its own kind of row, keeping offsets", () => {
    const { project: next, pasted } = pasteMultiClipboard(
      project(),
      clipboard,
      {},
      16,
      ids("p"),
    );
    assert.deepEqual(
      next.clips.map((clip) => [clip.laneId, clip.startQ]),
      [
        ["l1", 16],
        ["l2", 18],
      ],
    );
    assert.deepEqual(
      next.sourceSpans.map((item) => [item.sourceTrackId, item.startQ]),
      [["t1", 17]],
    );
    assert.deepEqual(
      pasted.map((item) => item.kind),
      ["span", "clip", "clip"],
    );
  });

  it("moves the topmost copied row to the target, keeping the rest below", () => {
    const { project: next } = pasteMultiClipboard(
      project(),
      clipboard,
      { laneId: "l2", sourceTrackId: "t2" },
      0,
      ids("p"),
    );
    assert.deepEqual(
      next.clips.map((clip) => clip.laneId),
      ["l2", "l3"],
    );
    assert.deepEqual(
      next.sourceSpans.map((item) => item.sourceTrackId),
      ["t2"],
    );
  });

  it("stops rows that would go past the last at the last", () => {
    const { project: next } = pasteMultiClipboard(
      project(),
      clipboard,
      { laneId: "l3" },
      0,
      ids("p"),
    );
    assert.deepEqual(
      next.clips.map((clip) => clip.laneId),
      ["l3", "l3"],
    );
  });
});
