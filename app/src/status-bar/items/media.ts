import { plural } from "../plural.ts";
import type { StatusItemProvider } from "../registry.ts";

// Offline media, while there is any.
export const mediaStatusItem: StatusItemProvider = {
  id: "media",
  order: 90,
  items: ({ offlineCount }) =>
    offlineCount > 0
      ? [
          {
            id: "media",
            label: "Media",
            value: `${offlineCount} offline`,
            title: `${plural(offlineCount, "media file")} offline`,
          },
        ]
      : [],
};
