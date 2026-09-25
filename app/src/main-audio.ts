import type { MediaItem } from "./media";

type MainAudioState = {
  mediaItems: MediaItem[];
  mainAudioId?: string;
};

// Makes `item` the session's main audio. Media ids come from the file's name,
// size and modification time, so choosing the same file again replaces its
// existing entry instead of adding a duplicate id.
export function withMainAudio(
  current: MainAudioState,
  item: MediaItem,
): Required<MainAudioState> {
  return {
    mediaItems: [
      ...current.mediaItems.filter((existing) => existing.id !== item.id),
      item,
    ],
    mainAudioId: item.id,
  };
}
