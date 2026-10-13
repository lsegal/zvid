import type { ExportProgress } from "./harness/contracts";
import { EXPORT_CONTAINER_LABELS } from "./session-settings.ts";

// How long a render runs before its time left is extrapolated; earlier
// estimates swing wildly (or read 0:00) from too few frames.
const MIN_ESTIMATE_ELAPSED_MS = 1000;

// How far back the render rate is measured, so the estimate follows the
// render speeding up or slowing down instead of its since-start average.
const RATE_WINDOW_MS = 5000;

type ProgressSample = { at: number; percent: number };

// Estimates seconds left in one export's render from its progress updates.
// Undefined until there is progress to extrapolate from. The rate comes from
// the trailing window, and the time left shown never climbs: when the render
// slows, it holds until the estimate catches up instead of counting up.
export function createExportTimeEstimator() {
  // The render's start at 0%, then each time the percentage rose.
  const samples: ProgressSample[] = [];
  let startedAt: number | null = null;
  let shown: number | undefined;
  return (progress: ExportProgress | null, now: number) => {
    const percent = progress?.progress;
    if (progress?.phase !== "rendering" || percent == null) {
      return undefined;
    }
    if (startedAt === null) {
      startedAt = now;
      samples.push({ at: now, percent: 0 });
    }
    if (percent > samples[samples.length - 1].percent) {
      samples.push({ at: now, percent });
    }
    if (percent <= 0 || now - startedAt < MIN_ESTIMATE_ELAPSED_MS) {
      return undefined;
    }
    // Measure from the newest earlier sample at least a window old.
    while (samples.length > 2 && samples[1].at <= now - RATE_WINDOW_MS) {
      samples.shift();
    }
    const from = samples[0];
    const percentPerMs = (percent - from.percent) / (now - from.at);
    const estimate = (100 - percent) / percentPerMs / 1000;
    shown = shown === undefined ? estimate : Math.min(shown, estimate);
    return shown;
  };
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
