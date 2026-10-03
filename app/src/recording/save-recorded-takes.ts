// Saving a finished recording pass so that captured media is never dropped:
// each take is saved on its own, a take whose file can't be analyzed is kept
// as recorded, and every take that can't be kept is reported with its reason.
import {
  createMediaId,
  type MediaItem,
  type Palette,
  toShareableMediaItem,
} from "../media.ts";
import {
  type PlacedTake,
  recordedTakeFileName,
  withRecordedDuration,
} from "./recorded-takes.ts";
import { type FinishedTake, recordingExtension } from "./recording-session.ts";

export type RecordedPass = {
  // Every track the pass recorded, whether or not it captured anything.
  trackIds: readonly string[];
  startQ: number;
  startedAt: Date;
  // Why tracks that stopped early stopped, by track ID.
  endedReasons: ReadonlyMap<string, string>;
};

export type SaveTakesDeps = {
  trackName: (trackId: string) => string;
  hasTrack: (trackId: string) => boolean;
  remux: (blob: Blob) => Promise<Blob>;
  // Analyzes one take's file; `index` picks its color.
  analyze: (file: File, index: number) => Promise<MediaItem | undefined>;
  createPreviewUrl: (file: File) => string;
  palettes: readonly Palette[];
  // Commits the takes as clips in one project change.
  place: (takes: PlacedTake[]) => void;
};

export type TakeFailure = { trackId: string; message: string };

export type SaveTakesResult = {
  // The placed takes' media, as read locally.
  items: MediaItem[];
  // How many placed takes couldn't be analyzed and were kept as recorded.
  unanalyzed: number;
  failures: TakeFailure[];
};

const NOTHING_CAPTURED = "nothing was captured";

/**
 * Saves each take of `pass` into the session at its start on its track.
 * One take failing never loses the others, and none of this throws.
 */
export async function saveRecordedTakes(
  pass: RecordedPass,
  finished: readonly FinishedTake[],
  deps: SaveTakesDeps,
): Promise<SaveTakesResult> {
  const failures: TakeFailure[] = [];
  const fail = (trackId: string, message: string) =>
    failures.push({ trackId, message });

  const captured = finished.filter((take) => take.blob.size > 0);
  for (const trackId of pass.trackIds) {
    if (!captured.some((take) => take.trackId === trackId)) {
      fail(trackId, pass.endedReasons.get(trackId) ?? NOTHING_CAPTURED);
    }
  }

  const prepared = await Promise.all(
    captured.map(async (take, index) => {
      try {
        return { take, ...(await prepareTake(pass, take, index, deps)) };
      } catch (error) {
        fail(take.trackId, errorMessage(error));
        return null;
      }
    }),
  );

  const kept = prepared.flatMap((entry) => {
    if (!entry) return [];
    if (!deps.hasTrack(entry.take.trackId)) {
      fail(entry.take.trackId, "its track was deleted while recording");
      return [];
    }
    return [entry];
  });
  if (!kept.length) {
    return { items: [], unanalyzed: 0, failures: sortFailures(pass, failures) };
  }

  try {
    deps.place(
      kept.map(({ take, item }) => ({
        trackId: take.trackId,
        item: toShareableMediaItem(item),
        startQ: pass.startQ,
      })),
    );
  } catch (error) {
    const message = errorMessage(error);
    for (const { take } of kept) fail(take.trackId, message);
    return { items: [], unanalyzed: 0, failures: sortFailures(pass, failures) };
  }

  return {
    items: kept.map(({ item }) => item),
    unanalyzed: kept.filter(({ analyzed }) => !analyzed).length,
    failures: sortFailures(pass, failures),
  };
}

async function prepareTake(
  pass: RecordedPass,
  take: FinishedTake,
  index: number,
  deps: SaveTakesDeps,
): Promise<{ item: MediaItem; analyzed: boolean }> {
  let blob = take.blob;
  try {
    blob = await deps.remux(take.blob);
  } catch (error) {
    console.warn("[zvid] Keeping the recording as recorded.", error);
  }
  const file = new File(
    [blob],
    recordedTakeFileName(
      deps.trackName(take.trackId),
      pass.startedAt,
      recordingExtension(take.mimeType),
    ),
    { type: take.mimeType, lastModified: Date.now() },
  );
  try {
    const analyzed = await deps.analyze(file, index);
    if (analyzed) {
      return {
        item: withRecordedDuration(analyzed, take.durationSeconds),
        analyzed: true,
      };
    }
  } catch (error) {
    console.warn("[zvid] Keeping the recording without analyzing it.", error);
  }
  return {
    item: unanalyzedTakeItem(
      file,
      take,
      deps.createPreviewUrl(file),
      deps.palettes[index % deps.palettes.length] ?? deps.palettes[0],
    ),
    analyzed: false,
  };
}

/**
 * The media item of a take as recorded, for when its file couldn't be
 * analyzed. It has no file details, so it's analyzed again once it can be.
 */
export function unanalyzedTakeItem(
  file: File,
  take: FinishedTake,
  previewUrl: string,
  palette: Palette | undefined,
): MediaItem {
  return {
    id: createMediaId(file),
    name: file.name,
    kind: take.hasVideo ? "video" : "audio",
    durationSeconds: take.durationSeconds,
    hasVideo: take.hasVideo,
    hasAudio: take.hasAudio,
    lastModified: file.lastModified,
    color: palette?.color ?? "#3d4052",
    accent: palette?.accent ?? "#7ca1ff",
    previewUrl,
    availability: "ready",
  };
}

// Failures in the order the tracks recorded.
function sortFailures(pass: RecordedPass, failures: TakeFailure[]) {
  const order = (trackId: string) => {
    const index = pass.trackIds.indexOf(trackId);
    return index < 0 ? pass.trackIds.length : index;
  };
  return failures.sort((a, b) => order(a.trackId) - order(b.trackId));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
