// The web driver: runs the editor in a plain browser, with no plugin, DAW or
// Rust harness. It answers the zvid:// protocol (see
// daw/crates/zvid-daw-ui/src/protocol.rs) in the page itself, as the
// `fetch` behind the editor's `Client`, from a TypeScript `MockBackend`.

import { Client } from "../ipc/client.ts";
import type { TakeInfo, UiError, ZvidConfig } from "../ipc/types.ts";
import { BackendError, MockBackend, rfc3339Utc } from "./mock-backend.ts";

/** How long a long-poll waits before answering with nothing new. */
const POLL_TIMEOUT_MS = 20_000;
/** Preview frame interval of the simulation, as in the harness. */
const FRAME_MS = 66;
/** File the demo takes and new takes point at, as in the harness. */
export const DEMO_CLIP = "demo-take-v2.mp4";

/** What the driver did on the desktop's behalf, oldest first. */
export type DesktopAction =
  | { action: "revealTake"; id: string }
  | { action: "openPrivacySettings" };

export type WebDriverOptions = {
  backend?: MockBackend;
  platform?: string;
  version?: string;
  pollTimeoutMs?: number;
};

export class WebDriver {
  readonly backend: MockBackend;
  readonly config: ZvidConfig;
  readonly desktop: DesktopAction[] = [];
  private readonly pollTimeoutMs: number;

  constructor(options: WebDriverOptions = {}) {
    this.backend = options.backend ?? new MockBackend();
    this.pollTimeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS;
    this.config = {
      origins: {
        app: "zvid://app",
        ipc: "zvid://ipc",
        preview: "zvid://preview",
        take: "zvid://take",
        thumb: "zvid://thumb",
      },
      version: options.version ?? "0.0.0-web",
      platform: options.platform ?? "macos",
    };
  }

  /** A `fetch` that serves zvid:// URLs from the mock backend. */
  readonly fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const match = /^zvid:\/\/([^/?#]+)\/?([^?#]*)(?:\?([^#]*))?/.exec(url);
    if (!match) return plain(404, "unknown URL");
    const [, host, path, query = ""] = match;
    const method = (init?.method ?? "GET").toUpperCase();
    const params = new URLSearchParams(query);
    const signal = init?.signal;
    signal?.throwIfAborted();

    if (host === "ipc" && method === "GET" && path === "events") {
      const after = params.get("after");
      const batch = await this.backend.events.poll(
        after === null ? undefined : Number(after),
        this.pollTimeoutMs,
        signal,
      );
      return json(200, batch);
    }
    if (host === "ipc" && method === "POST") {
      try {
        const body = typeof init?.body === "string" ? init.body : "null";
        return json(
          200,
          this.invoke(decodeURIComponent(path), JSON.parse(body || "null")),
        );
      } catch (error) {
        if (error instanceof BackendError) return errorResponse(error.error);
        return errorResponse({
          code: "invalidRequest",
          message: `${path}: ${String(error)}`,
        });
      }
    }
    if (host === "preview" && method === "GET") {
      const frame =
        path === ""
          ? this.backend.preview.latest()
          : path === "frame"
            ? await this.backend.preview.poll(
                Number(params.get("after") ?? 0),
                this.pollTimeoutMs,
                signal,
              )
            : undefined;
      if (frame === undefined) return plain(404, "unknown URL");
      if (!frame) return new Response(null, { status: 204 });
      return new Response(frame.frame, {
        headers: {
          "Content-Type": frame.frame.type,
          "Cache-Control": "no-store",
          "X-Frame-Seq": String(frame.seq),
        },
      });
    }
    return plain(404, "unknown URL");
  }) as typeof fetch;

  /** Runs an IPC command, as `Protocol::invoke` does. */
  invoke(command: string, args: unknown): unknown {
    const id = (): string => {
      const value = (args as { id?: unknown } | null)?.id;
      if (typeof value !== "string") {
        throw new BackendError(
          "invalidRequest",
          `${command} needs {"id": string}`,
        );
      }
      return value;
    };
    const backend = this.backend;
    switch (command) {
      case "getStatus":
        return backend.status();
      case "listCameras":
        return backend.cameras();
      case "selectCamera":
        backend.selectCamera(id());
        return null;
      case "refreshDevices":
        return backend.refreshDevices();
      case "arm":
        backend.arm();
        return null;
      case "disarm":
        backend.disarm();
        return null;
      case "listTakes":
        return backend.takes();
      case "revealTake": {
        const take = backend.take(id());
        if (!take) throw new BackendError("notFound", "unknown take");
        if (take.missing) {
          throw new BackendError("notFound", "the take's file is missing");
        }
        this.desktop.push({ action: "revealTake", id: take.id });
        return null;
      }
      case "openPrivacySettings":
        this.desktop.push({ action: "openPrivacySettings" });
        return null;
      default:
        throw new BackendError("invalidRequest", `unknown command ${command}`);
    }
  }

  /** A client for the editor. Take posters are drawn in the page. */
  client(): Client {
    return new WebClient(this);
  }

  /** A poster for the take, or undefined when it has no file. */
  posterUrl(id: string): string | undefined {
    const take = this.backend.take(id);
    if (!take || take.missing) return undefined;
    const hue = [...take.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">` +
      `<rect width="160" height="90" fill="hsl(${(hue * 47) % 360} 45% 35%)"/>` +
      `<circle cx="80" cy="45" r="18" fill="#eef2ff" opacity=".6"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  /**
   * Publishes preview frames and, like the harness, plays the transport for
   * 4 s and stops it for 2 s while armed (`autoTransport`), and cycles the
   * Live companion every 4 s through disconnected, Record off and Record on
   * (`live`). Returns a function that stops the simulation.
   */
  simulate({
    autoTransport = true,
    live = false,
  }: {
    autoTransport?: boolean;
    live?: boolean;
  } = {}): () => void {
    const backend = this.backend;
    const started = Date.now();
    let armedSince: number | null = null;
    const tick = () => {
      backend.publishFrame();
      if (live) {
        const phase = Math.floor((Date.now() - started) / 4000) % 3;
        backend.setLive(phase === 0 ? null : { recordArmed: phase === 2 });
      }
      if (autoTransport) {
        armedSince = backend.isArmed() ? (armedSince ?? Date.now()) : null;
        if (armedSince !== null) {
          const phase = ((Date.now() - armedSince) / 1000) % 6;
          backend.setPlaying(phase >= 1 && phase < 5);
        }
      }
    };
    tick();
    const timer = setInterval(tick, FRAME_MS);
    return () => clearInterval(timer);
  }
}

class WebClient extends Client {
  private readonly driver: WebDriver;

  constructor(driver: WebDriver) {
    super(driver.config, driver.fetch);
    this.driver = driver;
  }

  override thumbUrl(id: string): string {
    return this.driver.posterUrl(id) ?? super.thumbUrl(id);
  }
}

/**
 * The harness's demo takes: two placed takes and one whose file moved away,
 * relative to `now`.
 */
export function demoTakes(now = Date.now()): TakeInfo[] {
  const take = (
    id: string,
    filename: string,
    minutesAgo: number,
    durationSec: number,
    beats: number | null,
  ): TakeInfo => ({
    id,
    filename,
    createdAt: rfc3339Utc(now - minutesAgo * 60_000),
    durationSec,
    fileOffsetSec: durationSec / 6,
    transportStartBeats: beats,
    timeSignature: beats === null ? null : [4, 4],
    unanchored: beats === null,
    missing: filename !== DEMO_CLIP,
  });
  return [
    take("demo-3", "moved-away.mp4", 26 * 60, 12, null),
    take("demo-2", DEMO_CLIP, 10, 72, 0),
    take("demo-1", DEMO_CLIP, 5, 36, 64),
  ];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

/** The status `Protocol` answers a failed command with. */
function errorResponse(error: UiError): Response {
  const status =
    error.code === "invalidRequest"
      ? 400
      : error.code === "notFound"
        ? 404
        : error.code === "internal"
          ? 500
          : 409;
  return json(status, error);
}
