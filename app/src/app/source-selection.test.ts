import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findRestoredSourceSelection,
  findSelectedSourceTrack,
  isSourceSpanSelected,
  isSourceTrackSelected,
  keepSourceSelection,
  selectSourceSpan,
  selectSourceTrack,
  toSourceSelectionView,
} from "./source-selection.ts";

const tracks = [{ id: "track-a" }, { id: "track-b" }];
const spans = [
  { id: "span-a", sourceTrackId: "track-a" },
  { id: "span-b", sourceTrackId: "track-b" },
];

describe("source selection", () => {
  it("selects a source track on its own", () => {
    const selection = selectSourceTrack("track-a");
    assert.deepEqual(selection, { sourceTrackId: "track-a" });
    assert.ok(isSourceTrackSelected(selection, "track-a"));
    assert.ok(!isSourceTrackSelected(selection, "track-b"));
    assert.ok(!isSourceSpanSelected(selection, "span-a"));
  });

  it("makes a selected source clip's track the active source track", () => {
    const selection = selectSourceSpan(spans[1]);
    assert.deepEqual(selection, {
      sourceTrackId: "track-b",
      sourceSpanId: "span-b",
    });
    assert.ok(isSourceSpanSelected(selection, "span-b"));
    assert.ok(isSourceTrackSelected(selection, "track-b"));
    assert.ok(!isSourceSpanSelected(selection, "span-a"));
  });

  it("selecting the track again clears the source clip", () => {
    const selection = selectSourceTrack(
      selectSourceSpan(spans[0]).sourceTrackId,
    );
    assert.ok(isSourceTrackSelected(selection, "track-a"));
    assert.ok(!isSourceSpanSelected(selection, "span-a"));
  });

  it("is selected instead of a layer or clip, never alongside one", () => {
    const selection = selectSourceSpan(spans[0]);
    assert.equal(
      keepSourceSelection(selection, undefined, undefined),
      selection,
    );
    assert.equal(keepSourceSelection(selection, "clip", undefined), undefined);
    assert.equal(keepSourceSelection(selection, undefined, "1"), undefined);
    assert.equal(keepSourceSelection(selection, "clip", "1"), undefined);
    assert.equal(
      keepSourceSelection(undefined, undefined, undefined),
      undefined,
    );
  });

  it("is nothing when cleared", () => {
    assert.ok(!isSourceTrackSelected(undefined, "track-a"));
    assert.ok(!isSourceSpanSelected(undefined, "span-a"));
    assert.deepEqual(toSourceSelectionView(undefined), {
      selectedSourceTrackId: undefined,
      selectedSourceSpanId: undefined,
    });
  });
});

describe("restoring a source selection", () => {
  const roundTrip = (selection: Parameters<typeof toSourceSelectionView>[0]) =>
    findRestoredSourceSelection(
      JSON.parse(JSON.stringify(toSourceSelectionView(selection))),
      tracks,
      spans,
    );

  it("round-trips a selected source track and source clip", () => {
    assert.deepEqual(roundTrip(selectSourceTrack("track-b")), {
      sourceTrackId: "track-b",
    });
    assert.deepEqual(roundTrip(selectSourceSpan(spans[0])), {
      sourceTrackId: "track-a",
      sourceSpanId: "span-a",
    });
    assert.equal(roundTrip(undefined), undefined);
  });

  it("drops a selection whose track no longer exists", () => {
    assert.equal(
      findRestoredSourceSelection(
        { selectedSourceTrackId: "gone", selectedSourceSpanId: "span-a" },
        tracks,
        spans,
      ),
      undefined,
    );
  });

  it("keeps the track when its saved clip no longer exists on it", () => {
    assert.deepEqual(
      findRestoredSourceSelection(
        { selectedSourceTrackId: "track-a", selectedSourceSpanId: "gone" },
        tracks,
        spans,
      ),
      { sourceTrackId: "track-a" },
    );
    assert.deepEqual(
      findRestoredSourceSelection(
        { selectedSourceTrackId: "track-a", selectedSourceSpanId: "span-b" },
        tracks,
        spans,
      ),
      { sourceTrackId: "track-a" },
    );
  });

  it("finds the selected source track only while no source clip is selected", () => {
    assert.equal(
      findSelectedSourceTrack(selectSourceTrack("track-b"), tracks),
      tracks[1],
    );
    assert.equal(
      findSelectedSourceTrack(selectSourceSpan(spans[1]), tracks),
      undefined,
    );
    assert.equal(findSelectedSourceTrack(undefined, tracks), undefined);
    assert.equal(
      findSelectedSourceTrack(selectSourceTrack("gone"), tracks),
      undefined,
    );
  });
});
