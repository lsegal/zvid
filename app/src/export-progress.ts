import type { ExportProgress } from "./harness/contracts";
import { EXPORT_CONTAINER_LABELS } from "./session-settings.ts";

// Seconds left in an export's render, from how long the frames rendered so
// far took. Undefined until there is progress to extrapolate from.
export function estimateExportSecondsLeft(
  progress: ExportProgress | null,
  renderStartedAt: number | null,
  now: number,
) {
  const percent = progress?.progress;
  if (
    progress?.phase !== "rendering" ||
    percent == null ||
    percent <= 0 ||
    renderStartedAt === null
  ) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, now - renderStartedAt) / 1000;
  return (elapsedSeconds * (100 - percent)) / percent;
}

// Like "1:12" (or "1:02:03" past an hour), rounded up to the second.
export function formatSecondsLeft(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

// The status bar's export label, like "Exporting 42% · 1:12 left".
export function describeExportActivity(
  progress: ExportProgress | null,
  secondsLeft: number | undefined,
) {
  if (progress?.phase === "muxing") {
    return `Exporting · writing ${EXPORT_CONTAINER_LABELS[progress.container ?? "mp4"]}`;
  }
  const percent = progress?.progress;
  if (percent == null) {
    return "Exporting…";
  }
  return secondsLeft === undefined
    ? `Exporting ${percent}%`
    : `Exporting ${percent}% · ${formatSecondsLeft(secondsLeft)} left`;
}

// Like "12:04", the wall-clock time an export's snapshot was taken.
export function formatSnapshotTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
