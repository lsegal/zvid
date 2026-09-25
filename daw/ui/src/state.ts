import type { Camera, Status, TakeInfo, UiError } from "./ipc/types.ts";

export type Toast = { id: number; message: string };

export type AppState = {
  loaded: boolean;
  status: Status;
  /** `performance.now()` when `status` arrived, for the running timer. */
  statusAt: number;
  cameras: Camera[];
  takes: TakeInfo[];
  /** The command in flight, which disables the controls it drives. */
  busy: "select" | "arm" | "disarm" | "refresh" | null;
  toasts: Toast[];
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
  | { type: "dismiss"; id: number };

/** Most toasts shown at once; older ones drop off. */
const MAX_TOASTS = 3;

export const initialState: AppState = {
  loaded: false,
  status: {
    phase: "noCamera",
    cameraId: null,
    format: null,
    capture: null,
    error: null,
  },
  statusAt: 0,
  cameras: [],
  takes: [],
  busy: null,
  toasts: [],
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
        toasts: [
          ...state.toasts,
          { id: action.id, message: action.error.message },
        ].slice(-MAX_TOASTS),
      };
    case "dismiss":
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.id),
      };
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
