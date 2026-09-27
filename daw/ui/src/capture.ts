import type { Status } from "./ipc/types.ts";

/** What the capture card shows for a status. */
export type CaptureControls = {
  /**
   * The primary button: Record, Stop capturing, or none while Live's record
   * buttons arm capture. A running capture can always be stopped here.
   */
  button: "record" | "stop" | null;
  /** The Live companion's read-only indicator, while it is connected. */
  following: { armed: boolean } | null;
  helper: string;
};

export const HELPER_MANUAL =
  "Arm capture before you start playback or recording in Live.";
export const HELPER_FOLLOWING = "Turn on Record in Live to arm capture.";

export function captureControls(status: Status): CaptureControls {
  const capturing = status.phase === "capturing";
  const live = status.live;
  return {
    button: capturing ? "stop" : live ? null : "record",
    following: live ? { armed: live.recordArmed } : null,
    helper: live ? HELPER_FOLLOWING : HELPER_MANUAL,
  };
}
