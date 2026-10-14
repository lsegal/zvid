// The session's audio media as Drum Rack pads see it: the files a pad can
// play instead of its bank's sample, and the app's way of importing one.
// A pad names its media by path, as a LUT names its `.cube` file, so a
// session opens with its pads' samples on any machine that has the files.

import type { MediaItem } from "../../../media.ts";
import type { DrumRackParams } from "../../../midi-clip.ts";
import { findEffectMedia } from "../../effect-media.ts";
import { drumBankPadUrl } from "./banks.ts";
import { type DrumRackSettings, drumRackBank } from "./drum-rack.ts";

export type DrumSampleMedia = Pick<
  MediaItem,
  "id" | "name" | "sourcePath" | "previewUrl" | "availability"
>;

let sampleMedia: readonly DrumSampleMedia[] = [];
const listeners = new Set<() => void>();
// Counts changes, as a snapshot for useSyncExternalStore.
let version = 0;

export function getDrumSampleMediaVersion() {
  return version;
}

/** Calls `listener` when the session's audio media change. */
export function subscribeDrumSampleMedia(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDrumSampleMedia() {
  return sampleMedia;
}

/** Keeps the session's audio media, as the app has them now. */
export function setDrumSampleMedia(items: readonly MediaItem[]) {
  const next = items
    .filter((item) => item.kind === "audio")
    .map<DrumSampleMedia>((item) => ({
      id: item.id,
      name: item.name,
      sourcePath: item.sourcePath,
      previewUrl: item.previewUrl,
      availability: item.availability,
    }));
  const unchanged =
    next.length === sampleMedia.length &&
    next.every((item, index) => {
      const previous = sampleMedia[index];
      return (
        item.id === previous.id &&
        item.name === previous.name &&
        item.sourcePath === previous.sourcePath &&
        item.previewUrl === previous.previewUrl &&
        item.availability === previous.availability
      );
    });
  if (!unchanged) {
    sampleMedia = next;
    version++;
    for (const listener of listeners) {
      listener();
    }
  }
}

export function findDrumSampleMedia(path: string | undefined) {
  return findEffectMedia(path, sampleMedia);
}

// The URL to read the media `path` names from, while it is online.
function readyUrl(path: string) {
  const item = findDrumSampleMedia(path);
  return item?.availability === "ready" && item.previewUrl
    ? item.previewUrl
    : null;
}

/**
 * The samples `settings` play: each pad's own media while it is online,
 * else nothing, and its bank's sample when it has no media of its own.
 */
export function drumRackParams(settings: DrumRackSettings): DrumRackParams {
  const bank = drumRackBank(settings);
  return {
    samples: settings.pads.map((path, pad) =>
      path ? readyUrl(path) : drumBankPadUrl(bank, pad),
    ),
  };
}

/**
 * Imports audio into the media library: `files`, or one the user picks
 * when there are none. Resolves to the path a pad stores for the first
 * imported audio file, or undefined when nothing was imported.
 */
export type DrumSampleImporter = (
  files?: readonly File[],
) => Promise<string | undefined>;

let importer: DrumSampleImporter | undefined;

/** Sets how pads import their samples; the app sets it while it runs. */
export function setDrumSampleImporter(next: DrumSampleImporter | undefined) {
  importer = next;
}

/** Imports a pad's sample (see DrumSampleImporter). */
export function importDrumSample(files?: readonly File[]) {
  return importer ? importer(files) : Promise.resolve(undefined);
}
