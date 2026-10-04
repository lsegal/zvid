import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type {
  ArrangementClip,
  SourceSpan,
  SourceTrack,
  TimelineSelection,
} from "../app/types.ts";
import { matchesShortcutKey } from "./keys.ts";
import { dispatchShortcuts, shortcuts } from "./registry.ts";
import type { ShortcutContext } from "./types.ts";

// isEditableEventTarget checks DOM element classes, which node lacks.
class FakeElement {
  isContentEditable = false;
}
class FakeInput extends FakeElement {}
Object.assign(globalThis, {
  HTMLElement: FakeElement,
  HTMLInputElement: FakeInput,
  HTMLTextAreaElement: class extends FakeElement {},
  HTMLSelectElement: class extends FakeElement {},
});

type FakeKeyEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: unknown;
  defaultPrevented: boolean;
  preventDefault: () => void;
};

function press(
  key: string,
  modifiers: Partial<
    Pick<FakeKeyEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
  > & { target?: unknown; defaultPrevented?: boolean } = {},
) {
  const event: FakeKeyEvent = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    ...modifiers,
  };
  return event;
}

const clip = { id: "clip-1", laneId: "lane-1" } as ArrangementClip;
const selection = {
  id: "selection-lane-1",
  laneId: "lane-1",
  startQ: 0,
  durationQ: 4,
} as TimelineSelection;
const sourceTrack = { id: "source-track-1" } as SourceTrack;
const sourceSpan = {
  id: "source-span-1",
  sourceTrackId: "source-track-1",
} as SourceSpan;

let calls: string[];

function context(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(
        args.length
          ? `${name}(${args.map((arg) => JSON.stringify(arg) ?? "undefined").join(", ")})`
          : name,
      );
    };
  return {
    bpm: 120,
    clipActionsRef: {
      current: {
        copy: record("copy"),
        cut: record("cut"),
        paste: record("paste"),
        split: record("split"),
        duplicate: record("duplicate"),
        remove: record("remove"),
        copySelection: record("copySelection"),
        cutSelection: record("cutSelection"),
        deleteSelection: record("deleteSelection"),
      },
    } as unknown as ShortcutContext["clipActionsRef"],
    clipClipboardRef: { current: null },
    commitPendingSelectionToSourceTrack: record("commitToTrack"),
    deleteSourceTrack: record("deleteSourceTrack"),
    dragState: null,
    duplicateSourceTrack: record("duplicateSourceTrack"),
    fps: 30,
    fxLaneId: undefined,
    handleRedo: record("redo"),
    handleUndo: record("undo"),
    lanes: [],
    pendingSelection: null,
    playbackOriginRef: { current: 0 },
    playheadQRef: { current: 8 },
    selectedClip: undefined,
    selectedSourceSpan: undefined,
    selectedSourceTrack: undefined,
    setPendingSelection: record("setPendingSelection"),
    setPlayheadQ: record("setPlayheadQ"),
    setSelectedClipId: record("setSelectedClipId"),
    setSelectedLaneId: record("setSelectedLaneId"),
    sourceClipActionsRef: {
      current: {
        jumpToStart: record("source.jumpToStart"),
        cut: record("source.cut"),
        copy: record("source.copy"),
        paste: record("source.paste"),
        duplicate: record("source.duplicate"),
        split: record("source.split"),
        remove: record("source.remove"),
      },
    } as unknown as ShortcutContext["sourceClipActionsRef"],
    timelineContentEndQ: 16,
    timelineDragState: null,
    timelineScrollRef: { current: null },
    totalQuarters: 64,
    ...overrides,
  };
}

function dispatch(event: FakeKeyEvent, overrides?: Partial<ShortcutContext>) {
  dispatchShortcuts(
    shortcuts,
    context(overrides),
    event as unknown as KeyboardEvent,
  );
  return event;
}

beforeEach(() => {
  calls = [];
});

describe("shortcut table", () => {
  it("lists every shortcut once, in dispatch order", () => {
    assert.deepEqual(
      shortcuts.map(({ id, keys }) => `${id}: ${keys.join(", ")}`),
      [
        "selection.clear: Any+Escape",
        "selection.commit-to-track: Any+1, Any+2, Any+3, Any+4, Any+5, Any+6, Any+7, Any+8, Any+9",
        "history.undo: Mod+Z",
        "history.redo: Mod+Shift+Z, Mod+Y",
        "clipboard.copy: Mod+C",
        "clipboard.cut: Mod+X",
        "clipboard.paste: Mod+V",
        "clips.split: Mod+E",
        "clips.duplicate: Mod+D",
        "selection.deselect-clip: Escape",
        "transport.step-frame: ArrowLeft, ArrowRight",
        "transport.jump-to-edge: Home, End",
        "layers.step-selection: ArrowUp, ArrowDown",
        "clips.delete: Delete, Backspace",
      ],
    );
  });
});

describe("matchesShortcutKey", () => {
  const key = (
    name: string,
    modifiers: Partial<Record<"alt" | "ctrl" | "meta" | "shift", boolean>> = {},
  ) => ({
    key: name,
    altKey: Boolean(modifiers.alt),
    ctrlKey: Boolean(modifiers.ctrl),
    metaKey: Boolean(modifiers.meta),
    shiftKey: Boolean(modifiers.shift),
  });

  it("treats Ctrl and Cmd as Mod and ignores Alt and Shift beside it", () => {
    assert.equal(matchesShortcutKey("Mod+C", key("c", { ctrl: true })), true);
    assert.equal(matchesShortcutKey("Mod+C", key("c", { meta: true })), true);
    assert.equal(
      matchesShortcutKey("Mod+C", key("C", { ctrl: true, shift: true })),
      true,
    );
    assert.equal(
      matchesShortcutKey("Mod+C", key("c", { ctrl: true, alt: true })),
      true,
    );
    assert.equal(matchesShortcutKey("Mod+C", key("c")), false);
  });

  it("requires Shift only when named", () => {
    assert.equal(
      matchesShortcutKey("Mod+Shift+Z", key("z", { ctrl: true })),
      false,
    );
    assert.equal(
      matchesShortcutKey("Mod+Shift+Z", key("Z", { ctrl: true, shift: true })),
      true,
    );
    assert.equal(
      matchesShortcutKey("ArrowLeft", key("ArrowLeft", { shift: true })),
      true,
    );
  });

  it("keeps plain keys to presses without Ctrl, Cmd or Alt", () => {
    assert.equal(matchesShortcutKey("Escape", key("Escape")), true);
    assert.equal(
      matchesShortcutKey("Escape", key("Escape", { ctrl: true })),
      false,
    );
    assert.equal(
      matchesShortcutKey("Delete", key("Delete", { alt: true })),
      false,
    );
    assert.equal(matchesShortcutKey("Delete", key("Backspace")), false);
  });

  it("matches Any whatever modifiers are down", () => {
    assert.equal(
      matchesShortcutKey("Any+1", key("1", { ctrl: true, alt: true })),
      true,
    );
    assert.equal(matchesShortcutKey("Any+1", key("2")), false);
  });
});

describe("dispatching shortcuts", () => {
  it("undoes and redoes outside text entry", () => {
    dispatch(press("z", { ctrlKey: true }));
    dispatch(press("Z", { metaKey: true, shiftKey: true }));
    dispatch(press("y", { ctrlKey: true }));
    dispatch(press("z", { ctrlKey: true, target: new FakeInput() }));
    assert.deepEqual(calls, ["undo", "redo", "redo"]);
  });

  it("copies the selection's span before the selected clip", () => {
    const event = dispatch(press("c", { ctrlKey: true }), {
      pendingSelection: selection,
      selectedClip: clip,
    });
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(calls, [`copySelection(${JSON.stringify(selection)})`]);
  });

  it("leaves Ctrl+C alone without anything to copy", () => {
    const idle = dispatch(press("c", { ctrlKey: true }));
    assert.equal(idle.defaultPrevented, false);
    assert.deepEqual(calls, []);
  });

  it("pastes only with something on the clipboard", () => {
    dispatch(press("v", { ctrlKey: true }));
    dispatch(press("v", { ctrlKey: true }), {
      clipClipboardRef: {
        current: {} as NonNullable<
          ShortcutContext["clipClipboardRef"]["current"]
        >,
      },
    });
    assert.deepEqual(calls, ["paste"]);
  });

  it("commits the selection with a number key, whatever the modifiers", () => {
    dispatch(press("3", { ctrlKey: true }), { pendingSelection: selection });
    dispatch(press("3"));
    assert.deepEqual(calls, ["commitToTrack(2)"]);
  });

  it("clears the selection and deselects the clip on the same Escape", () => {
    dispatch(press("Escape"), {
      pendingSelection: selection,
      selectedClip: clip,
    });
    assert.deepEqual(calls, [
      "setPendingSelection(null)",
      "setSelectedClipId(undefined)",
    ]);
  });

  it("skips timeline editing while dragging or once a control handled the key", () => {
    dispatch(press("Delete"), {
      selectedClip: clip,
      dragState: {} as ShortcutContext["dragState"],
    });
    dispatch(press("ArrowLeft", { defaultPrevented: true }));
    dispatch(press("ArrowLeft", { altKey: true }));
    assert.deepEqual(calls, []);
  });

  it("steps the playhead a frame, or five with Shift", () => {
    // At 120 BPM and 30 fps a frame is 1/15 of a quarter.
    dispatch(press("ArrowRight"));
    dispatch(press("ArrowLeft", { shiftKey: true }));
    assert.deepEqual(calls, [
      `setPlayheadQ(${8 + 1 / 15})`,
      `setPlayheadQ(${8 - 5 / 15})`,
    ]);
  });

  it("jumps to the start and to the last frame of the content", () => {
    dispatch(press("Home"));
    dispatch(press("End"));
    assert.deepEqual(calls, [
      "setPlayheadQ(0)",
      `setPlayheadQ(${16 - 1 / 15})`,
    ]);
  });

  it("deletes the selection's span before the selected clip", () => {
    dispatch(press("Backspace"), {
      pendingSelection: selection,
      selectedClip: clip,
    });
    dispatch(press("Delete"), { selectedClip: clip });
    assert.deepEqual(calls, [
      `deleteSelection(${JSON.stringify(selection)})`,
      `remove(${JSON.stringify(clip)})`,
    ]);
  });

  it("deletes and duplicates the selected source track", () => {
    dispatch(press("Delete"), { selectedSourceTrack: sourceTrack });
    dispatch(press("Backspace"), { selectedSourceTrack: sourceTrack });
    dispatch(press("d", { ctrlKey: true }), {
      selectedSourceTrack: sourceTrack,
    });
    assert.deepEqual(calls, [
      `deleteSourceTrack(${JSON.stringify(sourceTrack)})`,
      `deleteSourceTrack(${JSON.stringify(sourceTrack)})`,
      `duplicateSourceTrack(${JSON.stringify(sourceTrack)})`,
    ]);
  });

  it("acts on the selection or selected clip before the source track", () => {
    dispatch(press("Delete"), {
      pendingSelection: selection,
      selectedSourceTrack: sourceTrack,
    });
    dispatch(press("Delete"), {
      selectedClip: clip,
      selectedSourceTrack: sourceTrack,
    });
    dispatch(press("d", { ctrlKey: true }), {
      selectedClip: clip,
      selectedSourceTrack: sourceTrack,
    });
    assert.deepEqual(calls, [
      `deleteSelection(${JSON.stringify(selection)})`,
      `remove(${JSON.stringify(clip)})`,
      `duplicate(${JSON.stringify(clip)})`,
    ]);
  });

  it("cuts, copies, pastes, duplicates and deletes the selected source clip", () => {
    const withSpan = { selectedSourceSpan: sourceSpan };
    const span = JSON.stringify(sourceSpan);
    dispatch(press("x", { ctrlKey: true }), withSpan);
    dispatch(press("c", { ctrlKey: true }), withSpan);
    dispatch(press("v", { ctrlKey: true }), {
      ...withSpan,
      clipClipboardRef: { current: { fragments: [], durationQ: 0 } },
    });
    dispatch(press("d", { ctrlKey: true }), withSpan);
    dispatch(press("Delete"), withSpan);
    assert.deepEqual(calls, [
      `source.cut(${span})`,
      `source.copy(${span})`,
      `source.paste(${JSON.stringify({ sourceTrackId: sourceSpan.sourceTrackId })})`,
      `source.duplicate(${span})`,
      `source.remove(${span})`,
    ]);
  });

  it("pastes into the selected source clip's or source track's track", () => {
    const clipboard = {
      clipClipboardRef: { current: { fragments: [], durationQ: 0 } },
    };
    dispatch(press("v", { ctrlKey: true }), {
      ...clipboard,
      selectedSourceSpan: sourceSpan,
    });
    dispatch(press("v", { ctrlKey: true }), {
      ...clipboard,
      selectedSourceTrack: sourceTrack,
    });
    // A selected clip still takes the paste.
    dispatch(press("v", { ctrlKey: true }), {
      ...clipboard,
      selectedClip: clip,
      selectedSourceTrack: sourceTrack,
    });
    const target = JSON.stringify({ sourceTrackId: sourceTrack.id });
    assert.deepEqual(calls, [
      `source.paste(${target})`,
      `source.paste(${target})`,
      "paste",
    ]);
  });

  it("never splits a selected source clip with Mod+E", () => {
    const event = dispatch(press("e", { ctrlKey: true }), {
      selectedSourceSpan: sourceSpan,
    });
    assert.deepEqual(calls, []);
    assert.equal(event.defaultPrevented, false);
  });

  it("acts on the selection or selected clip before the source clip", () => {
    const both = { selectedClip: clip, selectedSourceSpan: sourceSpan };
    dispatch(press("c", { ctrlKey: true }), {
      ...both,
      pendingSelection: selection,
    });
    dispatch(press("x", { ctrlKey: true }), both);
    dispatch(press("v", { ctrlKey: true }), {
      ...both,
      clipClipboardRef: { current: { fragments: [], durationQ: 0 } },
    });
    dispatch(press("d", { ctrlKey: true }), both);
    dispatch(press("Delete"), both);
    assert.deepEqual(calls, [
      `copySelection(${JSON.stringify(selection)})`,
      `cut(${JSON.stringify(clip)})`,
      "paste",
      `duplicate(${JSON.stringify(clip)})`,
      `remove(${JSON.stringify(clip)})`,
    ]);
  });

  it("leaves the selected source track alone while typing or dragging", () => {
    dispatch(press("Delete", { target: new FakeInput() }), {
      selectedSourceTrack: sourceTrack,
    });
    dispatch(press("Delete"), {
      selectedSourceTrack: sourceTrack,
      dragState: {} as ShortcutContext["dragState"],
    });
    assert.deepEqual(calls, []);
  });
});
