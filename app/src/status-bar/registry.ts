// The status bar is assembled from item providers, one per item, so adding
// an item means adding a provider instead of editing a shared builder.
import type { StatusItem, StatusItemsState } from "../status-items.ts";
import { audioStatusItem } from "./items/audio.ts";
import { collaborationStatusItem } from "./items/collaboration.ts";
import { contentStatusItem } from "./items/content.ts";
import { mediaStatusItem } from "./items/media.ts";
import { playheadStatusItem } from "./items/playhead.ts";
import { resolutionStatusItem } from "./items/resolution.ts";
import { sessionStatusItem } from "./items/session.ts";
import { timelineStatusItem } from "./items/timeline.ts";
import { versionStatusItem } from "./items/version.ts";

export type StatusItemProvider = {
  id: string;
  // Where the provider's items go; the bar lists providers by ascending order.
  order: number;
  items: (state: StatusItemsState) => StatusItem[];
};

export const statusItemProviders: readonly StatusItemProvider[] = [
  versionStatusItem,
  sessionStatusItem,
  timelineStatusItem,
  playheadStatusItem,
  resolutionStatusItem,
  audioStatusItem,
  collaborationStatusItem,
  contentStatusItem,
  mediaStatusItem,
];

export function buildStatusItems(state: StatusItemsState): StatusItem[] {
  return [...statusItemProviders]
    .sort((a, b) => a.order - b.order)
    .flatMap((provider) => provider.items(state));
}
