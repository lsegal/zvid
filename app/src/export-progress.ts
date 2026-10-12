import type { ExportProgress } from "./harness/contracts";
import { EXPORT_CONTAINER_LABELS } from "./session-settings.ts";

// How long a render runs before its time left is extrapolated; earlier
// estimates swing wildly (or read 0:00) from too few frames.
const MIN_ESTIMATE_ELAPSED_MS = 1000;

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
  const elapsedMs = now - renderStartedAt;
  if (elapsedMs < MIN_ESTIMATE_ELAPSED_MS) {
    return undefined;
  }
  const elapsedSeconds = elapsedMs / 1000;
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

// The Export dialog's time left, like "1:12 left", saying it is still
// estimating until the render has progress to extrapolate from.
export function describeExportTimeLeft(
  progress: ExportProgress | null,
  secondsLeft: number | undefined,
) {
  if (progress?.phase === "muxing") {
    return "Finishing up…";
  }
  return secondsLeft === undefined
    ? "Estimating time left…"
    : `${formatSecondsLeft(secondsLeft)} left`;
}

// Like "12:04", the wall-clock time an export's snapshot was taken.
export function formatSnapshotTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
