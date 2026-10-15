import { describeMultiSelection } from "../../app/multi-selection.ts";
import type { StatusItemProvider } from "../registry.ts";

// How many clips are selected, while more than one is.
export const selectionStatusItem: StatusItemProvider = {
  id: "selection",
  order: 85,
  items: ({ selectedClipCount }) =>
    selectedClipCount > 1
      ? [
          {
            id: "selection",
            label: "Selected",
            value: `${selectedClipCount}`,
            title: describeMultiSelection(selectedClipCount),
          },
        ]
      : [],
};
