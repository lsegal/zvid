// The right-click menu for the Audio row.
import type { ContextMenuEntry } from "../context-menu.ts";
import { audioEntries } from "./entries/audio.ts";
import { assembleMenu, type MenuEntryProvider } from "./registry.ts";

export type AudioMenuOptions = {
  disabled?: boolean;
  refresh: () => void;
};

export type AudioMenuContext = AudioMenuOptions & {
  disabled: boolean;
};

export const audioMenuEntries: readonly MenuEntryProvider<AudioMenuContext>[] =
  [audioEntries];

/** The Audio row menu: the row only shows the mix, so it only refreshes it. */
export function buildAudioMenuEntries({
  disabled = false,
  ...options
}: AudioMenuOptions): ContextMenuEntry[] {
  return assembleMenu(audioMenuEntries, { ...options, disabled });
}
