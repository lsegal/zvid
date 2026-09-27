import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CaptureCard } from "./components/CaptureCard.tsx";
import { Header } from "./components/Header.tsx";
import { Preview } from "./components/Preview.tsx";
import { TakesList } from "./components/TakesList.tsx";
import { Toast } from "./components/Toast.tsx";
import { deviceSummary, droppedSummary } from "./format.ts";
import { type Client, CommandError } from "./ipc/client.ts";
import type { UiError, UiEvent } from "./ipc/types.ts";
import {
  type AppState,
  captureElapsed,
  initialState,
  LIVE_SCRIPT_INSTALLED,
  reducer,
  selectedCamera,
} from "./state.ts";

/** Errors the preview already explains; no toast for these. */
const SHOWN_IN_PREVIEW = new Set<UiError["code"]>([
  "permissionDenied",
  "deviceBusy",
]);

/** `performance.now()`, ticking while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** The latest preview frame as an object URL, revoking old ones. */
function usePreview(client: Client): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void client.streamPreview((next) => {
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = next;
      setUrl(next);
    }, controller.signal);
    return () => {
      controller.abort();
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = null;
    };
  }, [client]);
  return url;
}

export function App({ client }: { client: Client }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const toastId = useRef(1);
  const frameUrl = usePreview(client);
  const now = useNow(state.status.phase === "capturing");

  const report = useCallback((error: unknown) => {
    const shown =
      error instanceof CommandError || error instanceof Error
        ? error
        : new Error(String(error));
    dispatch({ type: "error", error: shown, id: toastId.current++ });
  }, []);

  const dismiss = useCallback(
    (id: number) => dispatch({ type: "dismiss", id }),
    [],
  );

  const reload = useCallback(async () => {
    const [status, cameras, takes] = await Promise.all([
      client.invoke("getStatus"),
      client.invoke("listCameras"),
      client.invoke("listTakes"),
    ]);
    dispatch({ type: "loaded", status, cameras, takes, at: performance.now() });
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    const onEvent = (event: UiEvent) => {
      switch (event.event) {
        case "status":
          dispatch({
            type: "status",
            status: event.payload,
            at: performance.now(),
          });
          break;
        case "camerasChanged":
          dispatch({ type: "cameras", cameras: event.payload });
          break;
        case "takeClosed":
          dispatch({ type: "takeClosed", take: event.payload });
          break;
        case "error":
          if (!SHOWN_IN_PREVIEW.has(event.payload.code)) {
            report(new CommandError(event.payload));
          }
          break;
        case "takeOpened":
          // The status that follows carries the new take count.
          break;
      }
    };
    void client.listen(
      onEvent,
      () => void reload().catch(report),
      controller.signal,
    );
    return () => controller.abort();
  }, [client, reload, report]);

  const run = useCallback(
    async (
      busy: NonNullable<AppState["busy"]>,
      action: () => Promise<unknown>,
    ) => {
      dispatch({ type: "busy", busy });
      try {
        await action();
      } catch (error) {
        if (
          !(error instanceof CommandError && SHOWN_IN_PREVIEW.has(error.code))
        ) {
          report(error);
        }
      } finally {
        // Events normally deliver the new status; this covers a missed one.
        await client
          .invoke("getStatus")
          .then((status) =>
            dispatch({ type: "status", status, at: performance.now() }),
          )
          .catch(() => undefined);
        dispatch({ type: "busy", busy: null });
      }
    },
    [client, report],
  );

  const { status } = state;
  const camera = selectedCamera(state);
  const capturing = status.phase === "capturing";

  return (
    <div className="app">
      <Header
        phase={status.phase}
        elapsedMs={captureElapsed(state, now)}
        cameras={state.cameras}
        cameraId={status.cameraId}
        selectDisabled={capturing}
        selectBusy={state.busy === "refresh"}
        onSelect={(id) =>
          void run("select", () => client.invoke("selectCamera", { id }))
        }
      />
      <main className="body">
        <Preview
          status={status}
          frameUrl={frameUrl}
          platform={client.config.platform}
          refreshing={state.busy === "refresh"}
          onRefresh={() =>
            void run("refresh", async () => {
              const cameras = await client.invoke("refreshDevices");
              dispatch({ type: "cameras", cameras });
            })
          }
          onOpenPrivacySettings={() =>
            void client.invoke("openPrivacySettings").catch(report)
          }
        />
        <div className="side">
          <CaptureCard
            status={status}
            busy={state.busy === "arm" || state.busy === "disarm"}
            onRecord={() => void run("arm", () => client.invoke("arm"))}
            onStop={() => void run("disarm", () => client.invoke("disarm"))}
          />
          <TakesList
            takes={state.takes}
            platform={client.config.platform}
            takeUrl={(id) => client.takeUrl(id)}
            thumbUrl={(id) => client.thumbUrl(id)}
            loadFrame={(id, offsetSec, signal) =>
              client.takeFrame(id, offsetSec, signal)
            }
            onReveal={(id) =>
              void client.invoke("revealTake", { id }).catch(report)
            }
          />
        </div>
      </main>
      <footer className="footer">
        <span>
          {deviceSummary(camera, status.format)}
          {droppedSummary(status.capture) && (
            <span className="footer-dropped">
              {" · "}
              {droppedSummary(status.capture)}
            </span>
          )}
        </span>
        <span className="footer-end">
          {state.loaded && !status.live && (
            <button
              type="button"
              className="link-button footer-action"
              aria-busy={state.busy === "installScript"}
              disabled={state.busy === "installScript"}
              title="Copy the Live companion script into Live's User Library, so Live's record buttons arm capture"
              onClick={() =>
                void run("installScript", async () => {
                  await client.invoke("installLiveScript");
                  dispatch({
                    type: "notice",
                    message: LIVE_SCRIPT_INSTALLED,
                    id: toastId.current++,
                  });
                })
              }
            >
              Install Live companion
            </button>
          )}
          <span className="mono">v{client.config.version} · ZVID</span>
        </span>
      </footer>
      <Toast toast={state.toast} onDismiss={dismiss} />
    </div>
  );
}
