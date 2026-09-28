// A browser-side port of daw/crates/zvid-daw-ui/src/mock.rs and the event
// and preview channels in channels.rs, so the editor runs without the Rust
// harness. Keep its behaviour in step with the Rust mock.

import type {
  Camera,
  EventBatch,
  LiveInfo,
  Status,
  TakeInfo,
  UiError,
  UiEvent,
  VideoFormat,
} from "../ipc/types.ts";

export const DENIED_CAMERA = "mock-denied";
export const BUSY_CAMERA = "mock-busy";

/** Song tempo the mock transport runs at. */
const TEMPO = 120;
/** Events kept for pollers that fall behind, as in channels.rs. */
export const EVENT_BACKLOG = 256;

/** A rejected backend command. */
export class BackendError extends Error {
  readonly error: UiError;

  constructor(code: UiError["code"], message: string) {
    super(message);
    this.name = "BackendError";
    this.error = { code, message };
  }
}

/** Wakes async waiters, like the Condvars behind the Rust long-polls. */
class Changed {
  private readonly waiters = new Set<() => void>();

  notify(): void {
    for (const wake of [...this.waiters]) wake();
  }

  /** Resolves on the next notify or after `ms`; rejects when `signal` aborts. */
  wait(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        done();
        reject(signal?.reason);
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

/** A bounded, sequence-numbered log of events. */
export class EventLog {
  private readonly events: Array<{ seq: number; event: UiEvent }> = [];
  private readonly changed = new Changed();
  /** Sequence number of the most recent event; 0 before the first. */
  private head = 0;

  emit(event: UiEvent): void {
    this.head += 1;
    this.events.push({ seq: this.head, event: structuredClone(event) });
    while (this.events.length > EVENT_BACKLOG) this.events.shift();
    this.changed.notify();
  }

  /**
   * Events after `after`, waiting up to `timeoutMs` for one to arrive. With
   * no cursor it answers at once with the current head.
   */
  async poll(
    after: number | undefined,
    timeoutMs: number,
    signal?: AbortSignal | null,
  ): Promise<EventBatch> {
    if (after === undefined) {
      return { cursor: this.head, resync: false, events: [] };
    }
    const deadline = Date.now() + timeoutMs;
    while (this.head === after && Date.now() < deadline) {
      await this.changed.wait(deadline - Date.now(), signal);
    }
    // A cursor from the future (the backend restarted) or one older than
    // the backlog can't be served incrementally.
    const oldest = this.events[0]?.seq ?? this.head + 1;
    const resync =
      after > this.head || (this.head > after && after + 1 < oldest);
    return {
      cursor: this.head,
      resync,
      events: resync
        ? []
        : this.events
            .filter(({ seq }) => seq > after)
            .map(({ event }) => event),
    };
  }
}

export type PreviewFrame = { seq: number; frame: Blob };

/** The latest preview frame; pollers only ever see the newest one. */
export class PreviewSlot {
  private seq = 0;
  private frame: Blob | null = null;
  private readonly changed = new Changed();

  publish(frame: Blob): void {
    this.set(frame);
  }

  /** Drops the current frame, e.g. when the camera goes away. */
  clear(): void {
    this.set(null);
  }

  private set(frame: Blob | null): void {
    this.seq += 1;
    this.frame = frame;
    this.changed.notify();
  }

  latest(): PreviewFrame | null {
    return this.frame ? { seq: this.seq, frame: this.frame } : null;
  }

  /**
   * The first frame newer than `after`, waiting up to `timeoutMs`. `null` on
   * timeout or when the newest state is "no frame".
   */
  async poll(
    after: number,
    timeoutMs: number,
    signal?: AbortSignal | null,
  ): Promise<PreviewFrame | null> {
    const deadline = Date.now() + timeoutMs;
    while (this.seq === after || (this.seq > after && !this.frame)) {
      if (Date.now() >= deadline) return null;
      await this.changed.wait(deadline - Date.now(), signal);
    }
    return this.latest();
  }
}

/** Draws one preview frame of the test pattern. */
export type FrameRenderer = (pattern: {
  width: number;
  height: number;
  frame: number;
  capturing: boolean;
}) => Blob;

type Capture = {
  armedAt: number;
  takes: number;
  /** Start of the open take. */
  open: { at: number; offset: number; beats: number } | null;
};

export type MockBackendOptions = {
  /** Saved takes, as `listTakes` reports them. */
  takes?: TakeInfo[];
  /** File new takes point at; without one they are missing. */
  clip?: string;
  /** Milliseconds clock; `Date.now` by default. */
  now?: () => number;
  renderFrame?: FrameRenderer;
};

/**
 * A scripted backend with no camera or host: cameras are canned, the
 * transport is driven by `setPlaying`, the Live companion by `setLive`, and
 * preview frames are a test pattern. Two cameras fail on purpose:
 * `DENIED_CAMERA` (permission denied) and `BUSY_CAMERA` (in use).
 */
export class MockBackend {
  readonly events = new EventLog();
  readonly preview = new PreviewSlot();
  private readonly clip: string | undefined;
  private readonly now: () => number;
  private readonly renderFrame: FrameRenderer;
  private cameraList = defaultCameras();
  private extraCamera: Camera | null = {
    id: "mock-phone",
    name: "Pixel 8 (Link to Windows)",
    transport: "virtual",
  };
  private selected: string | null = null;
  private error: UiError | null = null;
  private capture: Capture | null = null;
  private takeList: TakeInfo[];
  private nextTake = 1;
  private frame = 0;
  private songBeats = 64;
  private live: LiveInfo | null = null;

  constructor(options: MockBackendOptions = {}) {
    this.takeList = [...(options.takes ?? [])];
    this.clip = options.clip;
    this.now = options.now ?? Date.now;
    this.renderFrame = options.renderFrame ?? svgTestPattern;
  }

  /**
   * Starts or stops the simulated transport. Playing while armed opens a
   * take; stopping closes it.
   */
  setPlaying(playing: boolean): void {
    const capture = this.capture;
    if (!capture) return;
    if (playing && !capture.open) {
      const now = this.now();
      capture.open = {
        at: now,
        offset: (now - capture.armedAt) / 1000,
        beats: this.songBeats,
      };
      const index = capture.takes;
      capture.takes += 1;
      this.events.emit({ event: "takeOpened", payload: { index } });
      this.emitStatus();
    } else if (!playing && capture.open) {
      const open = capture.open;
      capture.open = null;
      this.events.emit({ event: "takeClosed", payload: this.closeTake(open) });
      this.emitStatus();
    }
  }

  /**
   * Simulates the Live companion connecting, changing Live's record buttons,
   * or going away (`null`).
   */
  setLive(live: LiveInfo | null): void {
    if (this.live?.recordArmed === live?.recordArmed) return;
    this.live = live ? { ...live } : null;
    this.emitStatus();
  }

  /** Whether a capture is running. */
  isArmed(): boolean {
    return this.capture !== null;
  }

  /**
   * Publishes the next test-pattern preview frame, or clears the preview
   * when no camera is open.
   */
  publishFrame(): void {
    const format = formatOf(this.selected);
    if (!format || this.error) {
      this.preview.clear();
      return;
    }
    this.frame += 1;
    const [width, height] =
      format.height > format.width ? [180, 320] : [320, 180];
    this.preview.publish(
      this.renderFrame({
        width,
        height,
        frame: this.frame,
        capturing: this.capture !== null,
      }),
    );
  }

  cameras(): Camera[] {
    return structuredClone(this.cameraList);
  }

  selectCamera(id: string): void {
    if (this.capture) {
      throw new BackendError(
        "invalidRequest",
        "stop capturing before switching cameras",
      );
    }
    if (!this.cameraList.some((camera) => camera.id === id)) {
      throw new BackendError("notFound", "that camera is gone");
    }
    this.selected = id;
    this.error =
      id === DENIED_CAMERA
        ? {
            code: "permissionDenied",
            message: "Camera access is turned off for Ableton Live.",
          }
        : id === BUSY_CAMERA
          ? { code: "deviceBusy", message: "Another app is using this camera." }
          : null;
    this.emitStatus();
    if (this.error) {
      this.preview.clear();
      this.events.emit({ event: "error", payload: this.error });
      throw new BackendError(this.error.code, this.error.message);
    }
  }

  refreshDevices(): Camera[] {
    if (this.extraCamera) {
      this.cameraList.push(this.extraCamera);
      this.extraCamera = null;
    }
    this.events.emit({ event: "camerasChanged", payload: this.cameraList });
    return this.cameras();
  }

  arm(): void {
    if (!this.selected || this.error) {
      throw new BackendError(
        "invalidRequest",
        "choose a working camera before recording",
      );
    }
    this.capture ??= { armedAt: this.now(), takes: 0, open: null };
    this.emitStatus();
  }

  disarm(): void {
    const capture = this.capture;
    if (!capture) return;
    const open = capture.open;
    capture.open = null;
    const take = open || capture.takes === 0 ? this.closeTake(open) : undefined;
    this.capture = null;
    if (take) this.events.emit({ event: "takeClosed", payload: take });
    this.emitStatus();
  }

  status(): Status {
    const format = formatOf(this.selected);
    const capture = this.capture;
    const elapsedMs = capture ? Math.floor(this.now() - capture.armedAt) : 0;
    return {
      phase: this.error
        ? "error"
        : capture
          ? "capturing"
          : this.selected
            ? "ready"
            : "noCamera",
      cameraId: this.selected,
      format: this.error ? null : format,
      capture: capture && {
        elapsedMs,
        takes: capture.takes,
        // Simulated: one dropped frame every 10 s, so the footer counter
        // shows.
        droppedFrames: Math.floor(elapsedMs / 10_000),
      },
      error: this.error && { ...this.error },
      live: this.live && { ...this.live },
    };
  }

  /** The takes, newest first. */
  takes(): TakeInfo[] {
    // RFC 3339 UTC timestamps sort lexically; the stable sort keeps later
    // entries first when several share a timestamp.
    return structuredClone(this.takeList)
      .reverse()
      .sort((a, b) =>
        a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1,
      );
  }

  /** The take with this ID, or undefined for an unknown one. */
  take(id: string): TakeInfo | undefined {
    return this.takeList.find((take) => take.id === id);
  }

  private closeTake(open: Capture["open"]): TakeInfo {
    const id = `mock-take-${this.nextTake}`;
    this.nextTake += 1;
    const now = this.now();
    const duration = open
      ? (now - open.at) / 1000
      : (now - (this.capture?.armedAt ?? now)) / 1000;
    const take: TakeInfo = {
      id,
      filename: this.clip ?? `${id}-missing.mp4`,
      createdAt: rfc3339Utc(now),
      durationSec: duration,
      fileOffsetSec: open?.offset ?? 0,
      transportStartBeats: open?.beats ?? null,
      timeSignature: open ? [4, 4] : null,
      unanchored: !open,
      missing: this.clip === undefined,
    };
    if (open) {
      this.songBeats += Math.ceil((duration * TEMPO) / 60) + 4;
    }
    this.takeList.push(take);
    return structuredClone(take);
  }

  private emitStatus(): void {
    this.events.emit({ event: "status", payload: this.status() });
  }
}

function defaultCameras(): Camera[] {
  return [
    { id: "mock-builtin", name: "FaceTime HD Camera", transport: "builtIn" },
    { id: "mock-iphone", name: "iPhone Camera", transport: "continuity" },
    { id: "mock-usb", name: "Logitech BRIO", transport: "usb" },
    { id: DENIED_CAMERA, name: "Studio Display Camera", transport: "usb" },
    { id: BUSY_CAMERA, name: "OBS Virtual Camera", transport: "virtual" },
  ];
}

function formatOf(camera: string | null): VideoFormat | null {
  switch (camera) {
    case null:
      return null;
    case "mock-iphone":
    case "mock-phone":
      return { width: 1080, height: 1920, fps: [30, 1] };
    case "mock-usb":
      return { width: 3840, height: 2160, fps: [30000, 1001] };
    default:
      return { width: 1920, height: 1080, fps: [30, 1] };
  }
}

const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000"];

/**
 * The colour-bar test pattern with a sweep line, as SVG. The Rust mock sends
 * JPEG; the editor draws either, and SVG needs no canvas, so it works in
 * Node too.
 */
export const svgTestPattern: FrameRenderer = ({
  width,
  height,
  frame,
  capturing,
}) => {
  const bars = [...BARS, "#0000c0"]
    .map(
      (fill, index) =>
        `<rect x="${(index * width) / 7}" width="${width / 7 + 1}" height="${(height * 3) / 4}" fill="${fill}"/>`,
    )
    .join("");
  const sweep = (frame * 4) % width;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>` +
    `${bars}<rect y="${(height * 3) / 4}" width="${width}" height="${height / 4}" fill="url(#g)"/>` +
    `<rect x="${sweep - 2}" width="4" height="${height}" fill="${capturing ? "#ff6f9d" : "#eef2ff"}"/></svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
};

/** Formats milliseconds since the epoch as RFC 3339 UTC, to the second. */
export function rfc3339Utc(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}
