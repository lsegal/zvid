// The timeline toolbar's status light follows the transport: red while
// recording (which also plays), green while playing, yellow when stopped.
export type StatusLightState = "recording" | "playing" | "stopped";

export function getStatusLightState(
  isPlaying: boolean,
  isRecording: boolean,
): StatusLightState {
  if (isRecording) return "recording";
  return isPlaying ? "playing" : "stopped";
}

export const STATUS_LIGHT_LABELS: Record<StatusLightState, string> = {
  recording: "Recording",
  playing: "Playing",
  stopped: "Stopped",
};

export function getStatusLightClassName(state: StatusLightState): string {
  return state === "stopped"
    ? "status-light"
    : `status-light status-light--${state}`;
}
