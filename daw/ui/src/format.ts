import type {
  Camera,
  CaptureInfo,
  Phase,
  Transport,
  VideoFormat,
} from "./ipc/types.ts";

const pad = (value: number) => String(value).padStart(2, "0");

/** Capture timer: `00:00:05`. */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(total % 60)}`;
}

/** Take length: `mm:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = `${pad(minutes)}:${pad(total % 60)}`;
  return hours > 0 ? `${hours}:${rest}` : rest;
}

/**
 * Live-style transport position of a song position in quarter-note beats:
 * `Bar 17.1.1` is bar 17, beat 1, sixteenth 1.
 */
export function formatBarPosition(
  beats: number,
  [numerator, denominator]: [number, number],
): string {
  const beatLength = 4 / (denominator || 4);
  const barLength = (numerator || 4) * beatLength;
  // Nudge past float error so 63.9999999 still reads as bar 17.
  const position = Math.max(0, beats) + 1e-6;
  const bar = Math.floor(position / barLength);
  const inBar = position - bar * barLength;
  const beat = Math.floor(inBar / beatLength);
  const sixteenth = Math.floor((inBar - beat * beatLength) / 0.25);
  return `Bar ${bar + 1}.${beat + 1}.${sixteenth + 1}`;
}

/** Card heading: `Sep 25 · 8:36 PM` in the user's locale and time zone. */
export function formatTakeDate(
  iso: string,
  locale?: string,
  timeZone?: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
    .format(date)
    // Newer ICU data puts a narrow no-break space before AM/PM.
    .replace(/\u202f/g, " ");
  return `${day} · ${time}`;
}

export function formatFps([numerator, denominator]: [number, number]): string {
  const fps = numerator / (denominator || 1);
  const text = Number.isInteger(fps)
    ? String(fps)
    : String(Math.round(fps * 100) / 100);
  return `${text} fps`;
}

const TRANSPORTS: Record<Transport, string> = {
  builtIn: "Built-in",
  usb: "USB",
  continuity: "Continuity",
  virtual: "Virtual",
  network: "Network",
  unknown: "Camera",
};

export function transportLabel(transport: Transport): string {
  return TRANSPORTS[transport] ?? TRANSPORTS.unknown;
}

/** Footer: `FaceTime HD Camera · 1920×1080 · 30 fps`. */
export function deviceSummary(
  camera: Camera | undefined,
  format: VideoFormat | null,
): string {
  if (!camera) return "No camera";
  const parts = [camera.name];
  if (format) {
    parts.push(`${format.width}×${format.height}`, formatFps(format.fps));
  }
  return parts.join(" · ");
}

/** Footer, while recording: `3 dropped` once the encoder has fallen behind. */
export function droppedSummary(capture: CaptureInfo | null): string | null {
  if (!capture || capture.droppedFrames <= 0) return null;
  return `${capture.droppedFrames} dropped`;
}

export function statusLabel(phase: Phase): string {
  switch (phase) {
    case "noCamera":
      return "No camera";
    case "ready":
      return "Ready to capture";
    case "capturing":
      return "Capturing";
    case "error":
      return "Camera unavailable";
  }
}

/** File-manager name for the reveal button. */
export function fileManagerName(platform: string | undefined): string {
  return platform === "macos" ? "Finder" : "File Explorer";
}
