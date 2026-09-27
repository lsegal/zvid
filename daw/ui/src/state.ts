import type { Camera, Status, TakeInfo, UiError } from "./ipc/types.ts";

export type Toast = {
  id: number;
  message: string;
  /** Amber for problems, green for something that worked. */
  tone: "warning" | "ready";
};

/** The toast after the Live companion script is installed. */
export const LIVE_SCRIPT_INSTALLED =
  "Live companion installed. Restart Live, then pick ZVID Capture as a Control Surface in Settings › Link, Tempo & MIDI.";

export type AppState = {
  loaded: boolean;
  status: Status;
  /** `performance.now()` when `status` arrived, for the running timer. */
  statusAt: number;
  cameras: Camera[];
  takes: TakeInfo[];
  /** The command in flight, which disables the controls it drives. */
  busy: "select" | "arm" | "disarm" | "refresh" | "installScript" | null;
  /** At most one toast shows; a newer one replaces it. */
  toast: Toast | null;
};

export type Action =
  | {
      type: "loaded";
      status: Status;
      cameras: Camera[];
      takes: TakeInfo[];
      at: number;
    }
  | { type: "status"; status: Status; at: number }
  | { type: "cameras"; cameras: Camera[] }
  | { type: "takeClosed"; take: TakeInfo }
  | { type: "busy"; busy: AppState["busy"] }
  | { type: "error"; error: UiError | Error; id: number }
  | { type: "notice"; message: string; id: number }
  | { type: "dismiss"; id: number };

export const initialState: AppState = {
  loaded: false,
  status: {
    phase: "noCamera",
    cameraId: null,
    format: null,
    capture: null,
    error: null,
    live: null,
  },
  statusAt: 0,
  cameras: [],
  takes: [],
  busy: null,
  toast: null,
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        loaded: true,
        status: action.status,
        statusAt: action.at,
        cameras: action.cameras,
        takes: action.takes,
      };
    case "status":
      return { ...state, status: action.status, statusAt: action.at };
    case "cameras":
      return { ...state, cameras: action.cameras };
    case "takeClosed":
      return {
        ...state,
        takes: [
          action.take,
          ...state.takes.filter((take) => take.id !== action.take.id),
        ],
      };
    case "busy":
      return { ...state, busy: action.busy };
    case "error":
      return {
        ...state,
        toast: {
          id: action.id,
          message: action.error.message,
          tone: "warning",
        },
      };
    case "notice":
      return {
        ...state,
        toast: { id: action.id, message: action.message, tone: "ready" },
      };
    case "dismiss":
      return state.toast?.id === action.id ? { ...state, toast: null } : state;
  }
}

/** Milliseconds captured so far, running on from the last status. */
export function captureElapsed(state: AppState, now: number): number {
  const capture = state.status.capture;
  if (!capture) return 0;
  return capture.elapsedMs + Math.max(0, now - state.statusAt);
}

export function selectedCamera(state: AppState): Camera | undefined {
  return state.cameras.find((camera) => camera.id === state.status.cameraId);
}
