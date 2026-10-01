import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ClipWarp, warpSourceTime } from "./clip-warp.ts";
import {
  copyClip,
  copyRange,
  pasteClipboard,
  type RangeClip,
  removeRangeFromLane,
  resolveClipOverlaps,
  resolveContainerOverlaps,
  sliceClipToRange,
} from "./range-edit.ts";

// At 120 BPM a quarter lasts half a second.
const BPM = 120;

type TestClip = RangeClip & { label: string; warp?: ClipWarp };

// A clip from `startQ` for `durationQ` quarters, playing its source
// `sourceOffsetSeconds` ahead of the song.
function clip(
  id: string,
  startQ: number,
  durationQ: number,
  {
    laneId = "1",
    sourceOffsetSeconds = 10,
    warp = undefined as ClipWarp | undefined,
  } = {},
): TestClip {
  return {
    id,
    label: `Clip ${id}`,
    laneId,
    startQ,
    durationSeconds: durationQ / 2,
    trimStartSeconds: startQ / 2 + sourceOffsetSeconds,
    sourceOffsetSeconds,
    ...(warp ? { warp } : {}),
  };
}

// [id, lane, start, end, source start] for each clip, in quarters and
// seconds.
const spans = (clips: readonly TestClip[]) =>
  clips.map((item) => [
    item.id,
    item.laneId,
    item.startQ,
    item.startQ + item.durationSeconds * 2,
    item.trimStartSeconds,
  ]);

// The source second layer `laneId` plays at song position `q`, or undefined
// where it has no clip.
function sourceAt(clips: readonly TestClip[], q: number, laneId = "1") {
  const item = clips.find(
    (candidate) =>
      candidate.laneId === laneId &&
      q >= candidate.startQ &&
      q < candidate.startQ + candidate.durationSeconds * 2,
  );
  if (!item) {
    return undefined;
  }
  const linear = q / 2 + item.sourceOffsetSeconds;
  return item.warp ? warpSourceTime(item.warp, linear, BPM).seconds : linear;
}

const counter = (prefix: string) => {
  let next = 0;
  return () => `${prefix}${next++}`;
};

// Stretches the source: beats 0-4 play 0-1 s of it, beats 4-8 play 1-5 s.
const warp: ClipWarp = {
  markers: [
    { beatTime: 0, secTime: 0 },
    { beatTime: 4, secTime: 1 },
    { beatTime: 8, secTime: 5 },
  ],
  contentStartBeat: 0,
  anchorSeconds: 10,
};

describe("sliceClipToRange", () => {
  it("keeps a clip fully inside the range whole", () => {
    assert.deepEqual(
      sliceClipToRange(clip("a", 2, 2), 0, 8, BPM),
      clip("a", 2, 2),
    );
  });

  it("trims the left part and moves its source start", () => {
    const slice = sliceClipToRange(clip("a", 0, 4), 2, 8, BPM);
    assert.deepEqual(spans(slice ? [slice] : []), [["a", "1", 2, 4, 11]]);
    assert.equal(slice?.sourceOffsetSeconds, 10);
  });

  it("trims the right part and keeps its source start", () => {
    const slice = sliceClipToRange(clip("a", 4, 4), 0, 6, BPM);
    assert.deepEqual(spans(slice ? [slice] : []), [["a", "1", 4, 6, 12]]);
  });

  it("trims both sides of a clip spanning the range", () => {
    const slice = sliceClipToRange(clip("a", 0, 8), 2, 6, BPM);
    assert.deepEqual(spans(slice ? [slice] : []), [["a", "1", 2, 6, 11]]);
  });

  it("returns null for a clip outside or only touching the range", () => {
    assert.equal(sliceClipToRange(clip("a", 0, 2), 2, 4, BPM), null);
    assert.equal(sliceClipToRange(clip("a", 4, 2), 2, 4, BPM), null);
    assert.equal(sliceClipToRange(clip("a", 8, 2), 2, 4, BPM), null);
  });
});

describe("resolveClipOverlaps", () => {
  const place = (clips: TestClip[], active: TestClip) =>
    resolveClipOverlaps([...clips, active], active, BPM);

  it("trims a clip over the active clip's start to its left part", () => {
    assert.deepEqual(spans(place([clip("a", 0, 4)], clip("b", 2, 4))), [
      ["a", "1", 0, 2, 10],
      ["b", "1", 2, 6, 11],
    ]);
  });

  it("trims a clip over the active clip's end to its right part, moving its source start", () => {
    const placed = place([clip("a", 2, 4)], clip("b", 0, 4));
    assert.deepEqual(spans(placed), [
      ["a", "1", 4, 6, 12],
      ["b", "1", 0, 4, 10],
    ]);
    assert.equal(sourceAt(placed, 5), 12.5);
  });

  it("keeps the longer side of a clip spanning the active clip", () => {
    assert.deepEqual(spans(place([clip("a", 0, 8)], clip("b", 1, 2))), [
      ["a", "1", 3, 8, 11.5],
      ["b", "1", 1, 3, 10.5],
    ]);
  });

  it("removes a clip the active clip covers", () => {
    assert.deepEqual(spans(place([clip("a", 2, 2)], clip("b", 0, 8))), [
      ["b", "1", 0, 8, 10],
    ]);
  });

  it("leaves other layers and clips only touching it alone", () => {
    const others = [clip("a", 0, 4, { laneId: "2" }), clip("c", 6, 2)];
    assert.deepEqual(
      spans(place(others, clip("b", 2, 4))),
      spans([...others, clip("b", 2, 4)]),
    );
  });
});

describe("resolveContainerOverlaps", () => {
  type Row = { id: string; row: string; startQ: number; durationSeconds: number };
  const row = (id: string, rowId: string, startQ: number, durationQ: number) => ({
    id,
    row: rowId,
    startQ,
    durationSeconds: durationQ / 2,
  });
  const container = {
    containerOf: (item: Row) => item.row,
    retime: (item: Row, startQ: number, durationQ: number) => ({
      ...item,
      startQ,
      durationSeconds: durationQ / 2,
    }),
  };

  it("resolves overlaps only within the active clip's container", () => {
    const active = row("b", "x", 2, 4);
    assert.deepEqual(
      resolveContainerOverlaps(
        [row("a", "x", 0, 4), row("c", "y", 0, 8), row("d", "x", 3, 1), active],
        active,
        BPM,
        container,
      ),
      [row("a", "x", 0, 2), row("c", "y", 0, 8), active],
    );
  });
});

describe("removeRangeFromLane", () => {
  const remove = (clips: TestClip[], startQ: number, endQ: number) =>
    removeRangeFromLane(clips, "1", startQ, endQ, BPM, counter("new-"));

  it("removes a clip fully inside the range", () => {
    assert.deepEqual(remove([clip("a", 2, 2)], 0, 8), []);
    assert.deepEqual(remove([clip("a", 2, 2)], 2, 4), []);
  });

  it("trims a clip over the range's start to its left part", () => {
    assert.deepEqual(spans(remove([clip("a", 0, 4)], 2, 6)), [
      ["a", "1", 0, 2, 10],
    ]);
  });

  it("trims a clip over the range's end to its right part, moving its source start", () => {
    const [right] = remove([clip("a", 4, 4)], 2, 6);
    assert.deepEqual(spans(right ? [right] : []), [["a", "1", 6, 8, 13]]);
    assert.equal(right?.sourceOffsetSeconds, 10);
  });

  it("splits a clip spanning the range around a gap", () => {
    assert.deepEqual(spans(remove([clip("a", 0, 8)], 2, 6)), [
      ["a", "1", 0, 2, 10],
      ["new-0", "1", 6, 8, 13],
    ]);
  });

  it("changes only the range, on its layer, without closing the gap", () => {
    const before = [
      clip("a", 0, 3),
      clip("b", 3, 2),
      clip("c", 5, 3),
      clip("d", 9, 2),
      clip("e", 0, 12, { laneId: "2" }),
    ];
    const after = remove(before, 2, 6);
    assert.deepEqual(spans(after), [
      ["a", "1", 0, 2, 10],
      ["c", "1", 6, 8, 13],
      ["d", "1", 9, 11, 14.5],
      ["e", "2", 0, 12, 10],
    ]);
    // What still plays, plays the same source as before.
    for (const q of [0, 1, 6, 7, 9.5]) {
      assert.equal(sourceAt(after, q), sourceAt(before, q));
    }
    assert.equal(sourceAt(after, 3), undefined);
  });

  it("leaves clips only touching the range alone", () => {
    const clips = [clip("a", 0, 2), clip("b", 4, 2)];
    assert.deepEqual(remove(clips, 2, 4), clips);
  });

  it("keeps a warped clip's remaining parts playing the same source", () => {
    const before = [clip("a", 0, 8, { warp })];
    const after = remove(before, 2, 5);
    assert.equal(after.length, 2);
    for (const q of [0, 1.5, 5, 6.5, 7.75]) {
      assert.equal(sourceAt(after, q), sourceAt(before, q));
    }
    assert.ok(after.every((item) => item.warp === warp));
  });
});

describe("copyRange", () => {
  it("copies each clip's part in the range, relative to its start", () => {
    const content = copyRange(
      [
        clip("c", 5, 3),
        clip("a", 0, 3),
        clip("b", 3, 1),
        clip("x", 0, 12, { laneId: "2" }),
      ],
      "1",
      2,
      6,
      BPM,
    );
    assert.equal(content.durationQ, 4);
    assert.deepEqual(
      content.fragments.map(({ clip: item, offsetQ }) => [
        offsetQ,
        ...spans([item])[0],
      ]),
      [
        [0, "a", "1", 2, 3, 11],
        [1, "b", "1", 3, 4, 11.5],
        [3, "c", "1", 5, 6, 12.5],
      ],
    );
  });

  it("copies nothing from an empty range", () => {
    assert.deepEqual(copyRange([clip("a", 0, 2)], "1", 4, 6, BPM), {
      fragments: [],
      durationQ: 2,
    });
    assert.deepEqual(
      copyRange([clip("a", 0, 8, { laneId: "2" })], "1", 2, 6, BPM).fragments,
      [],
    );
  });
});

describe("pasteClipboard", () => {
  it("pastes a copied clip at the paste point, playing the same source", () => {
    const original = clip("a", 0, 4);
    const { clips, pasted } = pasteClipboard(
      [original],
      copyClip(original, BPM),
      "2",
      10,
      BPM,
      counter("p"),
    );
    assert.deepEqual(spans(clips), [
      ["a", "1", 0, 4, 10],
      ["p0", "2", 10, 14, 10],
    ]);
    assert.equal(sourceAt(pasted, 11, "2"), sourceAt([original], 1));
  });

  it("lays fragments out from the paste point, overwriting what they cover", () => {
    const content = copyRange(
      [clip("a", 0, 3), clip("b", 5, 3)],
      "1",
      2,
      6,
      BPM,
    );
    const { clips, pasted } = pasteClipboard(
      [clip("z", 20, 10, { laneId: "3", sourceOffsetSeconds: 50 })],
      content,
      "3",
      22,
      BPM,
      counter("p"),
    );
    assert.deepEqual(
      pasted.map((item) => [item.id, item.laneId, item.startQ]),
      [
        ["p0", "3", 22],
        ["p1", "3", 25],
      ],
    );
    // Clip z keeps its longer uncovered side of each pasted clip.
    assert.deepEqual(spans(clips), [
      ["z", "3", 26, 30, 63],
      ["p0", "3", 22, 23, 11],
      ["p1", "3", 25, 26, 12.5],
    ]);
  });

  it("reproduces cut content elsewhere, leaving other layers alone", () => {
    const before = [
      clip("a", 0, 3),
      clip("b", 5, 3, { warp }),
      clip("x", 0, 12, { laneId: "2" }),
    ];
    const content = copyRange(before, "1", 2, 6, BPM);
    const afterCut = removeRangeFromLane(
      before,
      "1",
      2,
      6,
      BPM,
      counter("split-"),
    );
    const { clips } = pasteClipboard(
      afterCut,
      content,
      "1",
      12,
      BPM,
      counter("p"),
    );
    // The span pasted at 12 plays what was cut from 2.
    for (const offsetQ of [0, 0.5, 3, 3.5]) {
      assert.equal(
        sourceAt(clips, 12 + offsetQ),
        sourceAt(before, 2 + offsetQ),
      );
    }
    assert.equal(sourceAt(clips, 13.5), undefined);
    assert.deepEqual(
      clips.filter((item) => item.laneId === "2"),
      [clip("x", 0, 12, { laneId: "2" })],
    );
  });
});

describe("removeRangeFromLane ids", () => {
  it("names the clip a split piece comes from", () => {
    const sources: string[] = [];
    removeRangeFromLane([clip("a", 0, 8)], "1", 2, 6, BPM, (source) => {
      sources.push(source.id);
      return "a-right";
    });
    assert.deepEqual(sources, ["a"]);
  });
});
