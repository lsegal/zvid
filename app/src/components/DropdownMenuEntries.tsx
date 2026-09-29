import { ChevronRightIcon } from "@heroicons/react/24/solid";
import type { ContextMenuEntry } from "../context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./ui/dropdown-menu";

/**
 * Renders context-menu entries (context-menu.ts) as dropdown items, so a
 * dropdown and a right-click menu can share one set of actions.
 */
export function DropdownMenuEntries({
  entries,
}: {
  entries: readonly ContextMenuEntry[];
}) {
  return entries.map((entry, index) => {
    if (entry.type === "separator") {
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no id and never move
      return <DropdownMenuSeparator key={`separator-${index}`} />;
    }

    if (entry.submenu) {
      return (
        <DropdownMenuSub key={entry.id}>
          <DropdownMenuSubTrigger disabled={entry.disabled} title={entry.title}>
            <span>{entry.label}</span>
            <ChevronRightIcon
              aria-hidden="true"
              className="dropdown-menu-sub-chevron"
            />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuEntries entries={entry.submenu} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }

    return (
      <DropdownMenuItem
        key={entry.id}
        disabled={entry.disabled}
        onSelect={() => entry.onSelect?.()}
        title={entry.title}
      >
        <span>{entry.label}</span>
        {entry.shortcut ? (
          <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>
        ) : null}
      </DropdownMenuItem>
    );
  });
}
