// The transport Record button's rules. Record starts playback from the
// playhead, or joins playback already running; Record again ends only the
// recording; stopping playback ends both.

// Saving runs from the end of a pass until its takes are in the session.
export type RecordPhase = "idle" | "starting" | "recording" | "saving";

/** Whether Record can be pressed: while recording, or idle with an armed track. */
export function canPressRecord(phase: RecordPhase, armedCount: number) {
  return phase === "recording" || (phase === "idle" && armedCount > 0);
}

export type RecordPress =
  | { action: "start"; startPlayback: boolean }
  | { action: "stop" }
  | { action: "none" };

/** What pressing Record does. Stopping a recording never stops playback. */
export function pressRecord(
  phase: RecordPhase,
  armedCount: number,
  isPlaying: boolean,
): RecordPress {
  if (phase === "recording") {
    return { action: "stop" };
  }
  if (!canPressRecord(phase, armedCount)) {
    return { action: "none" };
  }
  return { action: "start", startPlayback: !isPlaying };
}

/** Whether playback stopping should end the recording. */
export function playbackEndsRecording(phase: RecordPhase, isPlaying: boolean) {
  return phase === "recording" && !isPlaying;
}
