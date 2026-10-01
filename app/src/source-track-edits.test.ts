import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSwatch } from "./app/util.ts";
import {
  clipEffectTrackId,
  createEffect,
  type SessionEffect,
} from "./fx-stack.ts";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";
import {
  deleteSourceTrack,
  duplicateSourceTrack,
  moveSourceTrackTo,
  nextFreeSourceTrackColorIndex,
  type SourceTrackProject,
} from "./source-track-edits.ts";

type Track = {
  id: string;
  name: string;
  colorIndex: number;
  recordingPaths: string[];
};
type Span = {
  id: string;
  sourceTrackId: string;
  mediaPath: string;
  startQ: number;
  tint: string;
  accent: string;
};
type Clip = {
  id: string;
  sourceSpanId: string;
  sourceTrackId: string;
  laneId: string;
};
type Project = SourceTrackProject<Track, Span, Clip>;

function track(id: string, colorIndex: number): Track {
  return { id, name: `Track ${id}`, colorIndex, recordingPaths: [`${id}.mov`] };
}

function span(id: string, sourceTrackId: string, startQ: number): Span {
  const swatch = getSwatch(0);
  return {
    id,
    sourceTrackId,
    mediaPath: `${sourceTrackId}.mov`,
    startQ,
    tint: swatch.color,
    accent: swatch.accent,
  };
}

function makeProject(): Project {
  const effects: SessionEffect[] = [
    createEffect("1", "Blur", "blur-layer"),
    createEffect(clipEffectTrackId("c1"), "Blur", "blur-c1"),
    createEffect(clipEffectTrackId("c3"), "Blur", "blur-c3"),
  ];
  return {
    sourceTracks: [track("a", 0), track("b", 1), track("c", 2)],
    sourceSpans: [span("a1", "a", 0), span("b1", "b", 0), span("b2", "b", 8)],
    clips: [
      { id: "c1", sourceSpanId: "b1", sourceTrackId: "b", laneId: "1" },
      { id: "c2", sourceSpanId: "a1", sourceTrackId: "a", laneId: "1" },
      { id: "c3", sourceSpanId: "b2", sourceTrackId: "b", laneId: "2" },
      // A text clip has no source.
      { id: "c4", sourceSpanId: "", sourceTrackId: "", laneId: "2" },
    ],
    effects,
  };
}

function ids(items: readonly { id: string }[]) {
  return items.map((item) => item.id);
}

describe("nextFreeSourceTrackColorIndex", () => {
  it("picks the next color no track uses", () => {
    assert.equal(nextFreeSourceTrackColorIndex([{ colorIndex: 0 }], 0), 1);
    assert.equal(
      nextFreeSourceTrackColorIndex(
        [{ colorIndex: 0 }, { colorIndex: 1 }, { colorIndex: 2 }],
        1,
      ),
      3,
    );
    assert.equal(
      nextFreeSourceTrackColorIndex([{ colorIndex: 4 }, { colorIndex: 0 }], 4),
      1,
    );
  });

  it("takes the next color when every color is used", () => {
    const tracks = [0, 1, 2, 3, 4].map((colorIndex) => ({ colorIndex }));
    assert.equal(nextFreeSourceTrackColorIndex(tracks, 2), 3);
    assert.equal(nextFreeSourceTrackColorIndex(tracks, 4), 0);
  });
});

describe("duplicateSourceTrack", () => {
  it("adds a copy below with copies of its spans and leaves clips alone", () => {
    const project = makeProject();
    let next = 0;
    const result = duplicateSourceTrack(
      project,
      "b",
      "copy",
      () => `span-new-${++next}`,
    );

    assert.deepEqual(ids(result.sourceTracks), ["a", "b", "copy", "c"]);
    assert.deepEqual(result.sourceTracks[2], {
      id: "copy",
      name: "Track b copy",
      colorIndex: 3,
      recordingPaths: ["b.mov"],
    });
    const swatch = getSwatch(3);
    assert.deepEqual(result.sourceSpans.slice(3), [
      { ...span("b1", "b", 0), id: "span-new-1", sourceTrackId: "copy" },
      { ...span("b2", "b", 8), id: "span-new-2", sourceTrackId: "copy" },
    ].map((copied) => ({ ...copied, tint: swatch.color, accent: swatch.accent })));
    // The originals keep their ids and media.
    assert.deepEqual(result.sourceSpans.slice(0, 3), project.sourceSpans);
    assert.equal(result.clips, project.clips);
    assert.equal(result.effects, project.effects);
  });

  it("is unchanged for a missing track", () => {
    const project = makeProject();
    assert.equal(
      duplicateSourceTrack(project, "missing", "copy", () => "x"),
      project,
    );
  });
});

describe("deleteSourceTrack", () => {
  it("removes the track, its spans and the clips cut from them", () => {
    const project = makeProject();
    const result = deleteSourceTrack(project, "b");

    assert.deepEqual(ids(result.sourceTracks), ["a", "c"]);
    assert.deepEqual(ids(result.sourceSpans), ["a1"]);
    assert.deepEqual(ids(result.clips), ["c2", "c4"]);
    // The removed clips' own stacks go; the layer's stays.
    assert.deepEqual(ids(result.effects), ["blur-layer"]);
  });

  it("keeps the effects as they are when no clip goes", () => {
    const project = makeProject();
    const result = deleteSourceTrack(project, "c");
    assert.deepEqual(ids(result.sourceTracks), ["a", "b"]);
    assert.equal(result.clips.length, project.clips.length);
    assert.equal(result.effects, project.effects);
  });

  it("can delete the only track, and is unchanged for a missing one", () => {
    const project: Project = {
      ...makeProject(),
      sourceTracks: [track("a", 0)],
      sourceSpans: [span("a1", "a", 0)],
    };
    assert.deepEqual(deleteSourceTrack(project, "a").sourceTracks, []);
    assert.equal(deleteSourceTrack(project, "missing"), project);
  });
});

describe("moveSourceTrackTo", () => {
  it("moves the track to the index, keeping its spans", () => {
    const project = makeProject();
    const down = moveSourceTrackTo(project, "a", 2);
    assert.deepEqual(ids(down.sourceTracks), ["b", "c", "a"]);
    assert.equal(down.sourceSpans, project.sourceSpans);
    assert.deepEqual(
      ids(moveSourceTrackTo(project, "c", 0).sourceTracks),
      ["c", "a", "b"],
    );
    assert.deepEqual(
      ids(moveSourceTrackTo(project, "b", 99).sourceTracks),
      ["a", "c", "b"],
    );
  });

  it("is unchanged in place or for a missing track", () => {
    const project = makeProject();
    assert.equal(moveSourceTrackTo(project, "b", 1), project);
    assert.equal(moveSourceTrackTo(project, "missing", 0), project);
  });
});

describe("source track history", () => {
  it("undoes and redoes each edit as one step", () => {
    const initial = makeProject();
    const edits: [string, (current: Project) => Project][] = [
      [
        "Duplicate Track b",
        (current) => duplicateSourceTrack(current, "b", "copy", () => "new"),
      ],
      ["Delete Track b", (current) => deleteSourceTrack(current, "b")],
      ["Move Track a down", (current) => moveSourceTrackTo(current, "a", 1)],
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
});
