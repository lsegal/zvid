import type { MainAudioMenuContext } from "../audio-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

// Import, or Replace and Remove once there is audio.
export const mainAudioEntries: MenuEntryProvider<MainAudioMenuContext> = {
  id: "main-audio",
  order: 10,
  entries: ({ hasMainAudio, disabled, chooseFile, remove }) => {
    if (!hasMainAudio) {
      return [
        {
          type: "item",
          id: "import",
          label: "Import main audio…",
          disabled,
          onSelect: chooseFile,
        },
      ];
    }

    return [
      {
        type: "item",
        id: "replace",
        label: "Replace main audio…",
        disabled,
        onSelect: chooseFile,
      },
      {
        type: "item",
        id: "remove",
        label: "Remove main audio",
        disabled,
        onSelect: remove,
      },
    ];
  },
};
