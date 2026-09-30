import { formatShortcut } from "../../clip-menu.ts";
import type { ContextMenuEntry } from "../../context-menu.ts";
import { MAX_LAYERS } from "../../selection-overlaps.ts";
import type { MenuEntryProvider } from "../registry.ts";
import type { SourceSpanMenuContext } from "../source-span-menu.ts";

// "Copy to layer": the automatic choice, every layer, or a new one.
export const copySourceSpanToLayerEntry: MenuEntryProvider<SourceSpanMenuContext> =
  {
    id: "copy-to-layer",
    order: 20,
    entries: ({ lanes, mac, copyToLayer }) => {
      const laneEntries = lanes.map<ContextMenuEntry>((lane) => ({
        type: "item",
        id: `lane-${lane.id}`,
        label: lane.name,
        onSelect: () => copyToLayer({ kind: "lane", laneId: lane.id }),
      }));
      return [
        {
          type: "item",
          id: "copy-to-layer",
          label: "Copy to layer",
          submenu: [
            {
              type: "item",
              id: "auto",
              label: "Auto (last free layer)",
              shortcut: formatShortcut("click", mac),
              onSelect: () => copyToLayer({ kind: "auto" }),
            },
            ...(laneEntries.length
              ? [{ type: "separator" } as const, ...laneEntries]
              : []),
            { type: "separator" },
            {
              type: "item",
              id: "new",
              label: "New layer",
              disabled: lanes.length >= MAX_LAYERS,
              onSelect: () => copyToLayer({ kind: "new" }),
            },
          ],
        },
      ];
    },
  };
