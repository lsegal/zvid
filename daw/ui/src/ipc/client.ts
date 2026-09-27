// The frontend half of the zvid:// bridge: Tauri-style `invoke` over POST,
// `emit` events over a long-poll, and the preview as long-polled JPEGs.

import type {
  Commands,
  EventBatch,
  UiError,
  UiEvent,
  ZvidConfig,
} from "./types.ts";

declare global {
  interface Window {
    __ZVID__?: ZvidConfig;
  }
}

/** The host's configuration, or undefined outside the plugin/harness. */
export function hostConfig(): ZvidConfig | undefined {
  return typeof window === "undefined" ? undefined : window.__ZVID__;
}

/** A rejected command. */
export class CommandError extends Error {
  readonly code: UiError["code"];

  constructor(error: UiError) {
    super(error.message);
    this.name = "CommandError";
    this.code = error.code;
  }
}

/** Waits `ms`, or rejects as soon as `signal` aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

type Fetch = typeof fetch;

export class Client {
  readonly config: ZvidConfig;
  private readonly fetch: Fetch;

  constructor(config: ZvidConfig, fetchImpl: Fetch = fetch.bind(globalThis)) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async invoke<C extends keyof Commands>(
    command: C,
    ...args: Commands[C]["args"] extends undefined ? [] : [Commands[C]["args"]]
  ): Promise<Commands[C]["result"]> {
    const response = await this.fetch(`${this.config.origins.ipc}/${command}`, {
      method: "POST",
      // text/plain keeps the request "simple", so no CORS preflight.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(args[0] ?? null),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new CommandError(
        body && typeof body.message === "string"
          ? body
          : {
              code: "internal",
              message: `${command} failed (${response.status})`,
            },
      );
    }
    return body as Commands[C]["result"];
  }

  /**
   * Delivers events until `signal` aborts. `onResync` runs when the stream
   * starts and whenever events were missed, so callers reload full state.
   */
  async listen(
    onEvent: (event: UiEvent) => void,
    onResync: () => void,
    signal: AbortSignal,
  ): Promise<void> {
    let cursor: number | undefined;
    while (!signal.aborted) {
      try {
        const query = cursor === undefined ? "" : `?after=${cursor}`;
        const response = await this.fetch(
          `${this.config.origins.ipc}/events${query}`,
          { signal },
        );
        if (!response.ok) {
          throw new Error(`events: ${response.status}`);
        }
        const batch = (await response.json()) as EventBatch;
        const joined = cursor === undefined;
        cursor = batch.cursor;
        if (joined || batch.resync) {
          onResync();
        }
        for (const event of batch.events) {
          onEvent(event);
        }
      } catch {
        if (signal.aborted) return;
        cursor = undefined;
        await delay(1000, signal).catch(() => undefined);
      }
    }
  }

  /**
   * Hands each new preview frame to `onFrame` as an object URL until
   * `signal` aborts; `null` means the preview went away. The caller
   * revokes URLs it no longer shows.
   */
  async streamPreview(
    onFrame: (url: string | null) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let seq = 0;
    while (!signal.aborted) {
      try {
        const response = await this.fetch(
          `${this.config.origins.preview}/frame?after=${seq}`,
          { signal },
        );
        if (response.status === 204) {
          continue;
        }
        if (!response.ok) {
          throw new Error(`preview: ${response.status}`);
        }
        seq = Number(response.headers.get("X-Frame-Seq") ?? seq + 1);
        onFrame(URL.createObjectURL(await response.blob()));
      } catch {
        if (signal.aborted) return;
        onFrame(null);
        await delay(1000, signal).catch(() => undefined);
      }
    }
  }

  takeUrl(id: string): string {
    return `${this.config.origins.take}/${encodeURIComponent(id)}`;
  }

  thumbUrl(id: string): string {
    return `${this.config.origins.thumb}/${encodeURIComponent(id)}`;
  }

  /** The frame `offsetSec` into a take's file, decoded by the host. */
  frameUrl(id: string, offsetSec: number): string {
    return `${this.config.origins.frames}/${encodeURIComponent(id)}?t=${offsetSec.toFixed(3)}`;
  }

  /**
   * Fetches a host-decoded frame as an object URL the caller revokes. For
   * takes the webview can't decode itself.
   */
  async takeFrame(
    id: string,
    offsetSec: number,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.fetch(this.frameUrl(id, offsetSec), {
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new CommandError(
        body && typeof body.message === "string"
          ? body
          : { code: "internal", message: `frame failed (${response.status})` },
      );
    }
    return URL.createObjectURL(await response.blob());
  }
}
