import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";
import {
  capHistory,
  parseWorkspaceSession,
  serializeWorkspaceSession,
  type WorkspaceSession,
} from "./workspace-session.ts";

type Clip = { id: string; startQ: number; label?: string };
type State = { name: string; bpm: number; clips: Clip[]; mainAudioId?: string };
type View = { playheadQ: number; zoom?: number };

const options = {
  normalizeState(value: unknown): State {
    const state = value as State;
    if (!state || !Array.isArray(state.clips)) {
      throw new Error("bad state");
    }
    return state;
  },
  normalizeView(value: unknown): View {
    const view = (value ?? {}) as Partial<View>;
    return { playheadQ: view.playheadQ ?? 0, zoom: view.zoom };
  },
};

function buildHistory(edits: number) {
  const clips = Array.from({ length: 50 }, (_, index) => ({
    id: `clip-${index}`,
    startQ: index * 4,
    label: `Clip ${index} with a reasonably long label`,
  }));
  let history = createProjectHistoryState<State>({
    name: "Set",
    bpm: 120,
    clips,
  });
  for (let edit = 0; edit < edits; edit += 1) {
    history = projectHistoryReducer(history, {
      type: "commit",
      label: `Move clip ${edit}`,
      updater: (current) => ({
        ...current,
        clips: current.clips.map((clip, index) =>
          index === edit % current.clips.length
            ? { ...clip, startQ: clip.startQ + 1 }
            : clip,
        ),
      }),
    });
  }
  return history;
}

function session(
  history: ReturnType<typeof buildHistory>,
): WorkspaceSession<State, View> {
  return {
    history,
    view: { playheadQ: 12.5, zoom: 2 },
    source: { kind: "import", name: "Set.als" },
    importNotice: { title: "Imported Set", lines: ["13 tracks"] },
  };
}

describe("workspace session serialisation", () => {
  it("round-trips the present state, history, view and source", () => {
    let history = buildHistory(5);
    history = projectHistoryReducer(history, { type: "undo" });
    const restored = parseWorkspaceSession<State, View>(
      serializeWorkspaceSession(session(history)),
      options,
    );

    assert.deepEqual(restored.history.present, history.present);
    assert.deepEqual(restored.history.past, history.past);
    assert.deepEqual(restored.history.future, history.future);
    assert.deepEqual(restored.view, { playheadQ: 12.5, zoom: 2 });
    assert.deepEqual(restored.source, { kind: "import", name: "Set.als" });
    assert.deepEqual(restored.importNotice, {
      title: "Imported Set",
      lines: ["13 tracks"],
    });
  });

  it("lets undo revert the last action made before the save", () => {
    const history = buildHistory(3);
    const restored = parseWorkspaceSession<State, View>(
      serializeWorkspaceSession(session(history)),
      options,
    );
    const undone = projectHistoryReducer(
      { ...restored.history },
      { type: "undo" },
    );

    assert.equal(restored.history.past.at(-1)?.label, "Move clip 2");
    assert.deepEqual(undone.present, history.past.at(-1)?.snapshot);
  });

  it("stores objects shared between snapshots only once", () => {
    const history = buildHistory(40);
    const single = JSON.stringify(history.present).length;
    const large = serializeWorkspaceSession(session(history));
    const naive = JSON.stringify(history);

    // Each edit changes one clip, so forty more edits cost far less than
    // forty full snapshots.
    assert.ok(large.length < single * 10);
    assert.ok(large.length * 5 < naive.length);
  });

  it("restores shared objects as shared references", () => {
    const restored = parseWorkspaceSession<State, View>(
      serializeWorkspaceSession(session(buildHistory(2))),
      options,
    );
    const [first] = restored.history.past;

    assert.equal(first?.snapshot.clips[10], restored.history.present.clips[10]);
  });

  it("drops unset fields and non-finite numbers like JSON", () => {
    const history = createProjectHistoryState<State>({
      name: "Set",
      bpm: Number.NaN,
      clips: [],
      mainAudioId: undefined,
    });
    const restored = parseWorkspaceSession<State, View>(
      serializeWorkspaceSession(session(history)),
      options,
    );

    assert.equal("mainAudioId" in restored.history.present, false);
    assert.equal(restored.history.present.bpm, null);
  });

  it("keeps only the most recent history entries", () => {
    const history = buildHistory(8);
    const capped = capHistory(history, 3);

    assert.deepEqual(
      capped.past.map((entry) => entry.label),
      ["Move clip 5", "Move clip 6", "Move clip 7"],
    );

    const restored = parseWorkspaceSession<State, View>(
      serializeWorkspaceSession(session(history), { maxEntries: 3 }),
      options,
    );
    assert.equal(restored.history.past.length, 3);
    assert.equal(restored.history.past[0]?.label, "Move clip 5");
    assert.deepEqual(restored.history.present, history.present);
  });

  it("drops the oldest history until the payload fits the size cap", () => {
    const history = buildHistory(60);
    const full = serializeWorkspaceSession(session(history));
    const maxBytes = Math.floor(full.length * 2 * 0.6);
    const payload = serializeWorkspaceSession(session(history), { maxBytes });
    const restored = parseWorkspaceSession<State, View>(payload, options);

    assert.ok(payload.length * 2 <= maxBytes);
    assert.ok(restored.history.past.length < 60);
    assert.ok(restored.history.past.length > 0);
    assert.equal(restored.history.past.at(-1)?.label, "Move clip 59");
    assert.deepEqual(restored.history.present, history.present);
  });

  it("keeps the present state even when it alone exceeds the size cap", () => {
    const history = buildHistory(4);
    const restored = parseWorkspaceSession<State, View>(
      serializeWorkspaceSession(session(history), { maxBytes: 10 }),
      options,
    );

    assert.equal(restored.history.past.length, 0);
    assert.deepEqual(restored.history.present, history.present);
  });

  it("rejects payloads that do not parse or fail validation", () => {
    assert.throws(() => parseWorkspaceSession("{not json", options));
    assert.throws(() => parseWorkspaceSession("null", options));
    assert.throws(() =>
      parseWorkspaceSession(
        JSON.stringify({ nodes: [], past: [], present: [7], future: [] }),
        options,
      ),
    );
    assert.throws(() =>
      parseWorkspaceSession(
        JSON.stringify({
          nodes: [{ o: { name: "x" } }],
          past: [],
          present: [0],
          future: [],
        }),
        options,
      ),
    );
  });

  it("falls back to no source for an unknown source kind", () => {
    const payload = JSON.parse(
      serializeWorkspaceSession(session(buildHistory(0))),
    );
    payload.source = { kind: "mystery" };
    const restored = parseWorkspaceSession<State, View>(
      JSON.stringify(payload),
      options,
    );

    assert.deepEqual(restored.source, { kind: "none" });
  });
});
