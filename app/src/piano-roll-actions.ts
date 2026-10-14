// The piano roll's note actions: the keys that run them and the context
// menu that lists them (see components/midi/PianoRoll.tsx), and the note
// clipboard they share across clips.
import type { ContextMenuEntry } from "./context-menu.ts";
import { type NoteClipboard, PIANO_ROLL_SNAP_Q } from "./midi-piano-roll.ts";

export type NoteAction =
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeFineLeft"
  | "nudgeFineRight"
  | "pitchUp"
  | "pitchDown"
  | "duplicate"
  | "cut"
  | "copy"
  | "paste"
  | "delete";

/** The quarters and semitones each nudge or pitch action moves notes. */
export const NOTE_SHIFTS = {
  nudgeLeft: { deltaQ: -PIANO_ROLL_SNAP_Q, deltaPitch: 0 },
  nudgeRight: { deltaQ: PIANO_ROLL_SNAP_Q, deltaPitch: 0 },
  nudgeFineLeft: { deltaQ: -PIANO_ROLL_SNAP_Q / 2, deltaPitch: 0 },
  nudgeFineRight: { deltaQ: PIANO_ROLL_SNAP_Q / 2, deltaPitch: 0 },
  pitchUp: { deltaQ: 0, deltaPitch: 1 },
  pitchDown: { deltaQ: 0, deltaPitch: -1 },
} satisfies Partial<Record<NoteAction, { deltaQ: number; deltaPitch: number }>>;

const PLAIN_KEYS: Record<string, NoteAction> = {
  ArrowLeft: "nudgeLeft",
  ArrowRight: "nudgeRight",
  ArrowUp: "pitchUp",
  ArrowDown: "pitchDown",
  Delete: "delete",
  Backspace: "delete",
};

const SHIFT_KEYS: Record<string, NoteAction> = {
  ArrowLeft: "nudgeFineLeft",
  ArrowRight: "nudgeFineRight",
};

const MOD_KEYS: Record<string, NoteAction> = {
  d: "duplicate",
  x: "cut",
  c: "copy",
  v: "paste",
};

/**
 * The note action a key press asks for: the arrows nudge (Shift for half a
 * snap) or change pitch, Delete and Backspace delete, and Cmd (macOS) or
 * Ctrl with D, X, C or V duplicates, cuts, copies or pastes.
 */
export function noteActionForKey(
  event: {
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  },
  mac: boolean,
): NoteAction | undefined {
  if (event.altKey) {
    return undefined;
  }
  const mod = mac ? event.metaKey : event.ctrlKey;
  const otherMod = mac ? event.ctrlKey : event.metaKey;
  if (otherMod) {
    return undefined;
  }
  if (mod) {
    return event.shiftKey ? undefined : MOD_KEYS[event.key.toLowerCase()];
  }
  return (event.shiftKey ? SHIFT_KEYS : PLAIN_KEYS)[event.key];
}

/** Whether `action` needs selected notes; Paste needs the clipboard. */
export function isSelectionAction(action: NoteAction) {
  return action !== "paste";
}

/**
 * The note context menu: every note action with its shortcut, Paste
 * disabled while the clipboard is empty and the rest without a selection.
 */
export function noteMenuEntries({
  mac,
  hasSelection,
  canPaste,
  run,
}: {
  mac: boolean;
  hasSelection: boolean;
  canPaste: boolean;
  run: (action: NoteAction) => void;
}): ContextMenuEntry[] {
  const mod = mac ? "Cmd" : "Ctrl";
  const item = (
    action: NoteAction,
    label: string,
    shortcut: string,
  ): ContextMenuEntry => ({
    type: "item",
    id: action,
    label,
    shortcut,
    disabled: isSelectionAction(action) ? !hasSelection : !canPaste,
    onSelect: () => run(action),
  });
  return [
    item("nudgeLeft", "Nudge Left", "←"),
    item("nudgeRight", "Nudge Right", "→"),
    item("nudgeFineLeft", "Nudge Fine Left", "Shift+←"),
    item("nudgeFineRight", "Nudge Fine Right", "Shift+→"),
    { type: "separator" },
    item("pitchUp", "Pitch Up", "↑"),
    item("pitchDown", "Pitch Down", "↓"),
    { type: "separator" },
    item("duplicate", "Duplicate", `${mod}+D`),
    item("cut", "Cut", `${mod}+X`),
    item("copy", "Copy", `${mod}+C`),
    item("paste", "Paste", `${mod}+V`),
    { type: "separator" },
    item("delete", "Delete", "Del"),
  ];
}

// Copied notes, shared by every clip's piano roll.
let noteClipboard: NoteClipboard | undefined;

export function getNoteClipboard() {
  return noteClipboard;
}

export function setNoteClipboard(clipboard: NoteClipboard | undefined) {
  noteClipboard = clipboard;
}
