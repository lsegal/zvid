import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipEffectTrackId,
  createEffect,
  ensureLayerLayouts,
  isLayoutEffectName,
  type SessionEffect,
} from "./fx-stack.ts";
import {
  canMoveLane,
  createLaneId,
  deleteLane,
  duplicateLane,
  getNextLaneName,
  insertLane,
  type LaneProject,
  moveLane,
  moveLaneTo,
  renameLane,
} from "./lanes.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";

type Lane = { id: string; name: string; colorIndex: number };
type Clip = { id: string; laneId: string; startQ: number };
type Project = LaneProject<Lane, Clip>;

function lane(id: string, name = `Layer ${id}`): Lane {
  return { id, name, colorIndex: -1 };
}

function makeProject(): Project {
  const lanes = [lane("1"), lane("2"), lane("3")];
  const effects: SessionEffect[] = [
    ...ensureLayerLayouts(
      [],
      lanes.map((item) => item.id),
    ),
    createEffect("1", "Blur", "blur-1"),
    createEffect("2", "Blur", "blur-2"),
  ];
  return {
    lanes,
    clips: [
      { id: "c1", laneId: "1", startQ: 0 },
      { id: "c2", laneId: "2", startQ: 4 },
      { id: "c3", laneId: "2", startQ: 8 },
    ],
    effects,
  };
}

function laneNames(project: Project) {
  return project.lanes.map((item) => item.name);
}

function counter() {
  let next = 0;
  return (kind: "clip" | "effect") => `${kind}-new-${++next}`;
}

describe("createLaneId / getNextLaneName", () => {
  it("uses the next unused id and name", () => {
    assert.equal(createLaneId([lane("1"), lane("4")]), "5");
    assert.equal(getNextLaneName([lane("1"), lane("2")]), "Layer 3");
    assert.equal(getNextLaneName([lane("1"), lane("2", "Layer 3")]), "Layer 4");
  });
});

describe("insertLane", () => {
  it("inserts at the index with its own Layout", () => {
    const project = makeProject();
    const next = insertLane(project, 1, lane("9", "New"));
    assert.deepEqual(laneNames(next), ["Layer 1", "New", "Layer 2", "Layer 3"]);
    assert.ok(
      next.effects.some(
        (effect) =>
          effect.trackId === "9" && isLayoutEffectName(effect.effectName),
      ),
    );
    assert.equal(next.clips, project.clips);
  });

  it("clamps the index", () => {
    const project = makeProject();
    assert.equal(insertLane(project, -3, lane("9")).lanes[0].id, "9");
    assert.equal(insertLane(project, 99, lane("9")).lanes[3].id, "9");
  });

  it("does nothing at the layer limit", () => {
    const project = {
      ...makeProject(),
      lanes: Array.from({ length: MAX_LAYERS }, (_, index) =>
        lane(`${index + 1}`),
      ),
    };
    assert.equal(insertLane(project, 0, lane("99")), project);
  });
});

describe("duplicateLane", () => {
  it("adds a copy below with copied clips and effects under new ids", () => {
    const project = makeProject();
    const next = duplicateLane(project, "2", "4", counter());
    assert.deepEqual(laneNames(next), [
      "Layer 1",
      "Layer 2",
      "Layer 2 copy",
      "Layer 3",
    ]);
    assert.equal(next.lanes[2].id, "4");

    const copiedClips = next.clips.filter((clip) => clip.laneId === "4");
    assert.deepEqual(
      copiedClips.map((clip) => [clip.id, clip.startQ]),
      [
        ["clip-new-1", 4],
        ["clip-new-2", 8],
      ],
    );
    // The originals are untouched.
    assert.deepEqual(
      next.clips.filter((clip) => clip.laneId === "2").map((clip) => clip.id),
      ["c2", "c3"],
    );

    const sourceStack = next.effects.filter((effect) => effect.trackId === "2");
    const copiedStack = next.effects.filter((effect) => effect.trackId === "4");
    assert.deepEqual(
      copiedStack.map((effect) => effect.effectName),
      sourceStack.map((effect) => effect.effectName),
    );
    assert.ok(
      copiedStack.every((effect) => effect.id.startsWith("effect-new")),
    );
    // Parameters are copies, not shared.
    assert.notEqual(copiedStack[1].parameters, sourceStack[1].parameters);
    assert.deepEqual(copiedStack[1].parameters, sourceStack[1].parameters);
  });

  it("does nothing for a missing layer or at the layer limit", () => {
    const project = makeProject();
    assert.equal(duplicateLane(project, "x", "4", counter()), project);
    const full = {
      ...project,
      lanes: Array.from({ length: MAX_LAYERS }, (_, index) =>
        lane(`${index + 1}`),
      ),
    };
    assert.equal(duplicateLane(full, "1", "99", counter()), full);
  });
});

describe("deleteLane", () => {
  it("removes the layer with its clips and effects", () => {
    const project = makeProject();
    const next = deleteLane(project, "2");
    assert.deepEqual(laneNames(next), ["Layer 1", "Layer 3"]);
    assert.deepEqual(
      next.clips.map((clip) => clip.id),
      ["c1"],
    );
    assert.ok(next.effects.every((effect) => effect.trackId !== "2"));
    assert.ok(next.effects.some((effect) => effect.id === "blur-1"));
  });

  it("keeps the only layer", () => {
    const project = { ...makeProject(), lanes: [lane("1")] };
    assert.equal(deleteLane(project, "1"), project);
  });

  it("does nothing for a missing layer", () => {
    const project = makeProject();
    assert.equal(deleteLane(project, "x"), project);
  });
});

describe("moveLane", () => {
  it("swaps with the neighbor and keeps ids, clips and effects", () => {
    const project = makeProject();
    const down = moveLane(project, "1", 1);
    assert.deepEqual(
      down.lanes.map((item) => item.id),
      ["2", "1", "3"],
    );
    assert.equal(down.clips, project.clips);
    assert.equal(down.effects, project.effects);
    assert.deepEqual(
      moveLane(project, "3", -1).lanes.map((item) => item.id),
      ["1", "3", "2"],
    );
  });

  it("does nothing past the top or bottom", () => {
    const project = makeProject();
    assert.equal(moveLane(project, "1", -1), project);
    assert.equal(moveLane(project, "3", 1), project);
    assert.equal(canMoveLane(project.lanes, "1", -1), false);
    assert.equal(canMoveLane(project.lanes, "1", 1), true);
    assert.equal(canMoveLane(project.lanes, "3", 1), false);
    assert.equal(canMoveLane(project.lanes, "x", 1), false);
  });
});

describe("moveLaneTo", () => {
  function fiveLayers(): Project {
    const project = makeProject();
    return { ...project, lanes: [...project.lanes, lane("4"), lane("5")] };
  }

  it("moves a layer anywhere and keeps ids, clips and effects", () => {
    const project = fiveLayers();
    const up = moveLaneTo(project, "4", 0);
    assert.deepEqual(
      up.lanes.map((item) => item.id),
      ["4", "1", "2", "3", "5"],
    );
    assert.equal(up.clips, project.clips);
    assert.equal(up.effects, project.effects);
    assert.equal(up.lanes[0], project.lanes[3]);
    assert.deepEqual(
      moveLaneTo(project, "1", 3).lanes.map((item) => item.id),
      ["2", "3", "4", "1", "5"],
    );
  });

  it("clamps the target to the list", () => {
    const project = fiveLayers();
    assert.deepEqual(
      moveLaneTo(project, "2", 99).lanes.map((item) => item.id),
      ["1", "3", "4", "5", "2"],
    );
    assert.deepEqual(
      moveLaneTo(project, "2", -3).lanes.map((item) => item.id),
      ["2", "1", "3", "4", "5"],
    );
  });

  it("does nothing in place or for a missing layer", () => {
    const project = fiveLayers();
    assert.equal(moveLaneTo(project, "3", 2), project);
    assert.equal(moveLaneTo(project, "x", 0), project);
    assert.equal(moveLaneTo(project, "3", Number.NaN), project);
  });

  it("undoes a drag in one step", () => {
    const initial = fiveLayers();
    const committed = projectHistoryReducer(
      createProjectHistoryState(initial),
      {
        type: "commit",
        label: "Move Layer 4",
        updater: (current) => moveLaneTo(current, "4", 0),
      },
    );
    assert.equal(committed.past.length, 1);
    assert.equal(committed.past.at(-1)?.label, "Move Layer 4");
    const undone = projectHistoryReducer(committed, { type: "undo" });
    assert.equal(undone.present, initial);
  });
});

describe("renameLane", () => {
  it("renames with the trimmed name", () => {
    const next = renameLane(makeProject(), "2", "  Drums ");
    assert.deepEqual(laneNames(next), ["Layer 1", "Drums", "Layer 3"]);
  });

  it("ignores blank or unchanged names", () => {
    const project = makeProject();
    assert.equal(renameLane(project, "2", "   "), project);
    assert.equal(renameLane(project, "2", "Layer 2"), project);
    assert.equal(renameLane(project, "x", "Drums"), project);
  });
});

describe("undo", () => {
  it("brings back each edit in one step", () => {
    const initial = makeProject();
    const edits: Array<[string, (current: Project) => Project]> = [
      ["Delete Layer 2", (current) => deleteLane(current, "2")],
      [
        "Duplicate Layer 1",
        (current) => duplicateLane(current, "1", "4", counter()),
      ],
      ["Move Layer 1 down", (current) => moveLane(current, "1", 1)],
      ["Rename Layer 3", (current) => renameLane(current, "3", "Drums")],
      [
        "Insert layer above Layer 1",
        (current) => insertLane(current, 0, lane("5")),
      ],
    ];

    for (const [label, updater] of edits) {
      const committed = projectHistoryReducer(
        createProjectHistoryState(initial),
        { type: "commit", label, updater },
      );
      assert.notEqual(committed.present, initial, label);
      assert.equal(committed.past.at(-1)?.label, label);
      const undone = projectHistoryReducer(committed, { type: "undo" });
      assert.equal(undone.present, initial, label);
      const redone = projectHistoryReducer(undone, { type: "redo" });
      assert.deepEqual(redone.present, committed.present, label);
    }
  });

  it("records no history for a no-op", () => {
    const history = createProjectHistoryState(makeProject());
    const next = projectHistoryReducer(history, {
      type: "commit",
      label: "Move Layer 1 up",
      updater: (current) => moveLane(current, "1", -1),
    });
    assert.equal(next, history);
  });
});

describe("clip stacks", () => {
  function withClipStacks(): Project {
    const project = makeProject();
    return {
      ...project,
      effects: [
        ...project.effects,
        createEffect(clipEffectTrackId("c2"), "Transform", "c2-transform"),
        createEffect(clipEffectTrackId("c1"), "Colorize", "c1-colorize"),
      ],
    };
  }

  it("gives a duplicated layer's clips copies of their own stacks", () => {
    const next = duplicateLane(withClipStacks(), "2", "4", counter());
    const copy = next.clips.find(
      (clip) => clip.laneId === "4" && clip.startQ === 4,
    );
    assert.ok(copy);
    const copiedStack = next.effects.filter(
      (effect) => effect.trackId === clipEffectTrackId(copy.id),
    );
    assert.deepEqual(
      copiedStack.map((effect) => effect.effectName),
      ["Transform"],
    );
    assert.ok(copiedStack[0].id.startsWith("effect-new"));
    // The original keeps its own.
    assert.ok(next.effects.some((effect) => effect.id === "c2-transform"));
  });

  it("removes a deleted layer's clips' own stacks", () => {
    const next = deleteLane(withClipStacks(), "2");
    assert.ok(next.effects.every((effect) => effect.id !== "c2-transform"));
    assert.ok(next.effects.some((effect) => effect.id === "c1-colorize"));
  });
});
