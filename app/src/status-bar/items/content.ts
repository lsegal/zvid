import { plural } from "../plural.ts";
import type { StatusItemProvider } from "../registry.ts";

// How many clips are on how many tracks.
export const contentStatusItem: StatusItemProvider = {
  id: "content",
  order: 80,
  items: ({ clipCount, trackCount }) => [
    {
      id: "content",
      label: "Clips",
      value: `${clipCount} / ${trackCount}`,
      title: `${plural(clipCount, "clip")} on ${plural(trackCount, "track")}`,
    },
  ],
};
