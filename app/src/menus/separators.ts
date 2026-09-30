import type { ContextMenuEntry, ContextMenuItem } from "../context-menu.ts";

// Drops separators at either end and repeated ones left behind by removed
// items.
export function trimSeparators(entries: readonly ContextMenuEntry[]) {
  const trimmed: ContextMenuEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "item" || trimmed.at(-1)?.type === "item") {
      trimmed.push(entry);
    }
  }
  if (trimmed.at(-1)?.type === "separator") {
    trimmed.pop();
  }

  return trimmed;
}

/** A submenu named after what its actions apply to, e.g. "Clip: Intro". */
export function selectionSubmenu(
  id: string,
  kind: string,
  name: string,
  entries: readonly ContextMenuEntry[],
): ContextMenuItem {
  return {
    type: "item",
    id,
    label: `${kind}: ${name}`,
    submenu: trimSeparators(entries),
  };
}
