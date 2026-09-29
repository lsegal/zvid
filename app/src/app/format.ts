import { LOCATE_OFFLINE_MEDIA_HINT } from "./constants.ts";
import type { SessionMediaCheck } from "./types.ts";
import { pluralize } from "./util.ts";

export function formatSessionMediaCheckStatus(check: SessionMediaCheck) {
  return [formatSessionMediaStatus(check), check.overlapNote]
    .filter(Boolean)
    .join(" ");
}

export function formatSessionMediaStatus(check: SessionMediaCheck) {
  const { sessionName, restored, offline, hydratedFromDisk } = check;
  if (!restored && !offline) {
    return hydratedFromDisk
      ? `Loaded ${sessionName} with local media hydrated from disk.`
      : `Loaded ${sessionName}.`;
  }

  if (!restored && !hydratedFromDisk) {
    return `Loaded ${sessionName}. All referenced media is currently offline. ${LOCATE_OFFLINE_MEDIA_HINT}`;
  }

  const details: string[] = [];
  if (restored) {
    details.push(`Restored ${pluralize(restored, "media file")} from cache.`);
  }
  if (offline) {
    details.push(
      `${offline === 1 ? "1 clip is" : `${offline} clips are`} still offline. ${LOCATE_OFFLINE_MEDIA_HINT}`,
    );
  }
  return `Loaded ${sessionName}. ${details.join(" ")}`;
}

export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${minutes}:${remainderSeconds.toString().padStart(2, "0")}.${tenths}`;
}

export function formatHistoryStatus(prefix: "Undid" | "Redid", label: string) {
  return `${prefix}: ${label}.`;
}
