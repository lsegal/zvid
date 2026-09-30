import { formatStatusAudio } from "../../status-items.ts";
import type { StatusItemProvider } from "../registry.ts";

// The audio of the media under the playhead.
export const audioStatusItem: StatusItemProvider = {
  id: "audio",
  order: 60,
  items: (state) => {
    const audio = formatStatusAudio(state.audio);
    return [
      {
        id: "audio",
        label: "Audio",
        value: audio,
        title: `Audio: ${audio}`,
      },
    ];
  },
};
