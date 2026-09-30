// The right-click menu for the Audio row.
import type { ContextMenuEntry } from "../context-menu.ts";
import { mainAudioEntries } from "./entries/main-audio.ts";
import { assembleMenu, type MenuEntryProvider } from "./registry.ts";

export type MainAudioMenuOptions = {
  hasMainAudio: boolean;
  disabled?: boolean;
  chooseFile: () => void;
  remove: () => void;
};

export type MainAudioMenuContext = MainAudioMenuOptions & {
  disabled: boolean;
};

export const mainAudioMenuEntries: readonly MenuEntryProvider<MainAudioMenuContext>[] =
  [mainAudioEntries];

/** The Audio row menu: Import, or Replace and Remove once there is audio. */
export function buildMainAudioMenuEntries({
  disabled = false,
  ...options
}: MainAudioMenuOptions): ContextMenuEntry[] {
  return assembleMenu(mainAudioMenuEntries, { ...options, disabled });
}
