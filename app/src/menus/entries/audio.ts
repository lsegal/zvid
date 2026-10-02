import type { AudioMenuContext } from "../audio-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

// Re-resolves the audio mix, as the Audio row's Refresh button does.
export const audioEntries: MenuEntryProvider<AudioMenuContext> = {
  id: "audio",
  order: 10,
  entries: ({ disabled, refresh }) => [
    {
      type: "item",
      id: "refresh",
      label: "Recompute audio",
      disabled,
      onSelect: refresh,
    },
  ],
};
