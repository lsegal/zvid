import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";
import {
  type DropClip,
  dropClipOnFreeLane,
  isSourceClipDropClick,
  pickDropLane,
} from "./source-clip-drop.ts";

// At 60 BPM one quarter lasts one second.
const BPM = 60;

type Lane = { id: string; name: string };
type Clip = DropClip & { id: string };

const lane = (id: string): Lane => ({ id, name: `Layer ${id}` });
const lanesUpTo = (count: number) =>
  Array.from({ length: count }, (_, index) => lane(`${index + 1}`));
const clip = (
  id: string,
  laneId: string,
  startQ: number,
  endQ: number,
): Clip => ({ id, laneId, startQ, durationSeconds: endQ - startQ });

describe("pickDropLane", () => {
  it("picks the last lane with no overlapping clip", () => {
    const lanes = lanesUpTo(3);
    const clips = [clip("a", "1", 0, 8), clip("b", "3", 4, 12)];

    assert.equal(pickDropLane(lanes, clips, 6, 10, BPM), "2");
    assert.equal(pickDropLane(lanes, clips, 12, 16, BPM), "3");
  });

  it("does not count touching edges as an overlap", () => {
    const lanes = lanesUpTo(2);
    const clips = [clip("a", "2", 0, 4), clip("b", "2", 8, 12)];

    assert.equal(pickDropLane(lanes, clips, 4, 8, BPM), "2");
  });

  it("asks for a new lane when every lane overlaps", () => {
    const lanes = lanesUpTo(2);
    const clips = [clip("a", "1", 0, 8), clip("b", "2", 6, 10)];

    assert.equal(pickDropLane(lanes, clips, 4, 8, BPM), "new");
    assert.equal(pickDropLane([], [], 0, 4, BPM), "new");
  });

  it("reports full when every lane overlaps at the layer limit", () => {
    const lanes = lanesUpTo(MAX_LAYERS);
    const clips = lanes.map((item) => clip(`c${item.id}`, item.id, 0, 8));

    assert.equal(pickDropLane(lanes, clips, 2, 4, BPM), "full");
    assert.equal(pickDropLane(lanes, clips, 8, 12, BPM), `${MAX_LAYERS}`);
  });
});

describe("dropClipOnFreeLane", () => {
  type State = { lanes: Lane[]; clips: Clip[] };

  function dropIntoHistory(state: State, dropped: Clip) {
    const history = projectHistoryReducer(createProjectHistoryState(state), {
      type: "commit",
      label: "Add clip from source",
      updater: (current) => {
        const result = dropClipOnFreeLane(
          current.lanes,
          current.clips,
          dropped,
          BPM,
          () => lane(`${current.lanes.length + 1}`),
        );
        return result
          ? { lanes: result.lanes, clips: result.clips }
          : current;
      },
    });
    return history;
  }

  it("drops the clip onto the last free layer", () => {
    const state: State = {
      lanes: lanesUpTo(3),
      clips: [clip("a", "3", 0, 8)],
    };
    const result = dropClipOnFreeLane(
      state.lanes,
      state.clips,
      clip("new", "", 2, 6),
      BPM,
      () => assert.fail("no lane should be created"),
    );

    assert.ok(result);
    assert.equal(result.clip.laneId, "2");
    assert.equal(result.createdLane, false);
    assert.equal(result.lanes, state.lanes);
    assert.deepEqual(result.clips, [...state.clips, result.clip]);
    assert.equal(result.clip.startQ, 2);
    assert.equal(result.clip.durationSeconds, 4);
  });

  it("creates a new layer when every layer overlaps", () => {
    const state: State = {
      lanes: lanesUpTo(2),
      clips: [clip("a", "1", 0, 8), clip("b", "2", 0, 8)],
    };
    const result = dropClipOnFreeLane(
      state.lanes,
      state.clips,
      clip("new", "", 2, 6),
      BPM,
      () => lane("3"),
    );

    assert.ok(result);
    assert.equal(result.createdLane, true);
    assert.deepEqual(result.lanes, lanesUpTo(3));
    assert.equal(result.clip.laneId, "3");
  });

  it("adds nothing at the layer limit", () => {
    const lanes = lanesUpTo(MAX_LAYERS);
    const clips = lanes.map((item) => clip(`c${item.id}`, item.id, 0, 8));

    assert.equal(
      dropClipOnFreeLane(lanes, clips, clip("new", "", 2, 6), BPM, () =>
        assert.fail("no lane should be created"),
      ),
      null,
    );

    const state: State = { lanes, clips };
    const history = dropIntoHistory(state, clip("new", "", 2, 6));
    assert.equal(history.present, state);
    assert.equal(history.past.length, 0);
  });

  it("undoes the clip and the layer it created in one step", () => {
    const state: State = {
      lanes: lanesUpTo(1),
      clips: [clip("a", "1", 0, 8)],
    };
    const history = dropIntoHistory(state, clip("new", "", 2, 6));

    assert.equal(history.present.lanes.length, 2);
    assert.equal(history.present.clips.length, 2);
    assert.deepEqual(
      history.past.map((entry) => entry.label),
      ["Add clip from source"],
    );

    const undone = projectHistoryReducer(history, { type: "undo" });
    assert.equal(undone.present, state);
  });
});

describe("isSourceClipDropClick", () => {
  it("accepts Ctrl or Cmd and rejects a plain click", () => {
    assert.equal(isSourceClipDropClick({ ctrlKey: true, metaKey: false }), true);
    assert.equal(isSourceClipDropClick({ ctrlKey: false, metaKey: true }), true);
    assert.equal(
      isSourceClipDropClick({ ctrlKey: false, metaKey: false }),
      false,
    );
  });
});
