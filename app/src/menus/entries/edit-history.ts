import type { ContextMenuEntry } from "../../context-menu.ts";
import type { EditMenuContext } from "../edit-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

export const editHistoryEntries: MenuEntryProvider<EditMenuContext> = {
  id: "history",
  order: 10,
  entries: ({ history }) => history,
};

/** Undo and Redo, named after the change each would undo or redo. */
export function buildHistoryEntries({
  undoLabel,
  redoLabel,
  canUndo,
  canRedo,
  disabled,
  shortcuts,
  undo,
  redo,
}: {
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  canUndo: boolean;
  canRedo: boolean;
  // Editing is disabled while exporting.
  disabled: boolean;
  shortcuts: { undo: string; redo: string };
  undo: () => void;
  redo: () => void;
}): ContextMenuEntry[] {
  return [
    {
      type: "item",
      id: "undo",
      label: undoLabel ? `Undo ${undoLabel}` : "Undo",
      shortcut: shortcuts.undo,
      disabled: disabled || !canUndo,
      onSelect: undo,
    },
    {
      type: "item",
      id: "redo",
      label: redoLabel ? `Redo ${redoLabel}` : "Redo",
      shortcut: shortcuts.redo,
      disabled: disabled || !canRedo,
      onSelect: redo,
    },
  ];
}
