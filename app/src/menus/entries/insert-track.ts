import { sourceTrackKeyNumber } from "../../clip-menu.ts";
import type { ContextMenuEntry } from "../../context-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";
import type { SelectionMenuContext } from "../selection-menu.ts";

export const NO_FOOTAGE_TITLE = "No footage here";

// Every source track, committed like pressing its number key.
export const insertTrackEntry: MenuEntryProvider<SelectionMenuContext> = {
  id: "insert-track",
  order: 20,
  entries: ({ tracks, disabled, insertTrack }) => {
    const trackEntries = tracks.map<ContextMenuEntry>((track, index) => {
      const keyNumber = sourceTrackKeyNumber(index);
      return {
        type: "item",
        id: `track-${track.id}`,
        label: track.name,
        swatch: track.color,
        shortcut: keyNumber === undefined ? undefined : `${keyNumber}`,
        disabled: disabled || !track.hasFootage,
        title: track.hasFootage ? undefined : NO_FOOTAGE_TITLE,
        onSelect: () => insertTrack(index),
      };
    });
    return [
      {
        type: "item",
        id: "insert-track",
        label: "Insert Track",
        disabled: disabled || !trackEntries.length,
        submenu: trackEntries,
      },
    ];
  },
};
