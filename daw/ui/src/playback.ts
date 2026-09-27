// Take preview playback: where the playhead is, and when the webview needs
// the host to decode the take for it.

/** `MediaError.MEDIA_ERR_DECODE` */
const MEDIA_ERR_DECODE = 3;
/** `MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED` */
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/**
 * Whether a `<video>` error means the webview can't decode the take, so the
 * preview switches to frames the host decodes. WebView2 plays HEVC only with
 * Microsoft's HEVC Video Extensions installed.
 */
export function needsHostFrames(code: number | undefined): boolean {
  return code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED;
}

/** Consecutive host frames that may fail before the preview gives up. */
const MAX_FRAME_FAILURES = 10;

/**
 * Whether a host frame that failed to load ends the preview: always when the
 * take's file is gone, otherwise once `failures` frames in a row have failed.
 */
export function frameFailureIsFatal(error: unknown, failures: number) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "notFound" || failures >= MAX_FRAME_FAILURES;
}

/** `positionSec` kept inside a take of `durationSec`. */
export function clampPosition(positionSec: number, durationSec: number) {
  if (!Number.isFinite(positionSec)) return 0;
  return Math.min(Math.max(positionSec, 0), Math.max(durationSec, 0));
}

/**
 * The playhead of a clock started at `fromSec`, `elapsedMs` ago, stopping at
 * the end of the take.
 */
export function clockPosition(
  fromSec: number,
  elapsedMs: number,
  durationSec: number,
): number {
  return clampPosition(fromSec + elapsedMs / 1000, durationSec);
}

/**
 * Where playing resumes from: the start again once the playhead has reached
 * the end.
 */
export function resumePosition(positionSec: number, durationSec: number) {
  return positionSec >= durationSec
    ? 0
    : clampPosition(positionSec, durationSec);
}
