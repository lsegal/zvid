// One recording pass: a MediaRecorder per armed source track, all started
// at the same moment, each on its track's camera and microphone. A track
// whose device fails or goes away stops on its own, keeping what it
// recorded; the others carry on.
import {
  type AvailableInputs,
  type RecordInputs,
  withBrowserDefaults,
} from "./record-inputs.ts";

// The parts of MediaRecorder a recording uses, so tests can stand one in.
export type MediaRecorderLike = {
  readonly state: "inactive" | "recording" | "paused";
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};

export type RecordingDeps = {
  enumerateDevices: () => Promise<
    (Pick<MediaDeviceInfo, "deviceId" | "kind"> &
      Partial<Pick<MediaDeviceInfo, "groupId" | "label">>)[]
  >;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  isTypeSupported: (mimeType: string) => boolean;
  createRecorder: (
    stream: MediaStream,
    options: { mimeType?: string },
  ) => MediaRecorderLike;
  // Undefined `available` when the device list couldn't be read.
  resolveInputs: (trackId: string, available?: AvailableInputs) => RecordInputs;
  now: () => number;
};

// The attached cameras and microphones, by device ID.
export function availableInputs(
  devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind">[],
): AvailableInputs {
  const ids = (kind: MediaDeviceKind) =>
    devices
      .filter((device) => device.kind === kind)
      .map((device) => device.deviceId);
  return { video: ids("videoinput"), audio: ids("audioinput") };
}

/** The `getUserMedia` constraints for `inputs`; null when both are None. */
export function getRecordMediaConstraints(
  inputs: RecordInputs,
): MediaStreamConstraints | null {
  if (inputs.video === null && inputs.audio === null) {
    return null;
  }
  const constraint = (input: string | null | undefined) =>
    input === null ? false : input ? { deviceId: { exact: input } } : true;
  return { video: constraint(inputs.video), audio: constraint(inputs.audio) };
}

// How often recorders hand over what they captured, in milliseconds.
const RECORDER_TIMESLICE_MS = 1000;

const VIDEO_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];
const VIDEO_ONLY_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];
const AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/** The first recording format the browser supports for these tracks. */
export function pickRecorderMimeType(
  hasVideo: boolean,
  hasAudio: boolean,
  isTypeSupported: (mimeType: string) => boolean,
): string | undefined {
  const candidates = hasVideo
    ? hasAudio
      ? VIDEO_MIME_TYPES
      : VIDEO_ONLY_MIME_TYPES
    : AUDIO_MIME_TYPES;
  return candidates.find((type) => {
    try {
      return isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/** The file extension for a recorder's MIME type. */
export function recordingExtension(mimeType: string) {
  if (/mp4/i.test(mimeType))
    return mimeType.startsWith("audio") ? "m4a" : "mp4";
  if (/ogg/i.test(mimeType)) return "ogg";
  return "webm";
}

export type RecordingTake = {
  trackId: string;
  stream: MediaStream;
  hasVideo: boolean;
  hasAudio: boolean;
  // When this track stopped early, in seconds after the pass started.
  endedAtSeconds?: number;
};

export type FinishedTake = {
  trackId: string;
  blob: Blob;
  mimeType: string;
  hasVideo: boolean;
  durationSeconds: number;
};

export type RecordingFailure = { trackId: string; message: string };

type TakeState = RecordingTake & {
  recorder: MediaRecorderLike;
  chunks: Blob[];
  stopped: Promise<void>;
  markStopped: () => void;
  stopRequested: boolean;
};

function describeError(error: unknown) {
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name);
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "access to the camera or microphone was denied";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "its camera or microphone isn't connected";
    }
    if (name === "NotReadableError") {
      return "its camera or microphone is in use by another app";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export type RecordingSessionCallbacks = {
  // A track stopped early: its device went away or its recorder failed.
  onTrackEnded?: (trackId: string, message: string) => void;
};

export class RecordingSession {
  private readonly takes: TakeState[];
  private readonly deps: RecordingDeps;
  private readonly callbacks: RecordingSessionCallbacks;
  private startedAt = 0;
  private finished = false;

  private constructor(
    takes: TakeState[],
    deps: RecordingDeps,
    callbacks: RecordingSessionCallbacks,
  ) {
    this.takes = takes;
    this.deps = deps;
    this.callbacks = callbacks;
  }

  /**
   * Opens the inputs of every track in `trackIds` and readies a recorder on
   * each, without starting them. Tracks whose inputs are both None are
   * skipped; tracks whose devices can't be opened are listed in `failures`.
   */
  static async open(
    trackIds: readonly string[],
    deps: RecordingDeps,
    callbacks: RecordingSessionCallbacks = {},
  ) {
    let devices: Awaited<ReturnType<RecordingDeps["enumerateDevices"]>> = [];
    let available: AvailableInputs | undefined;
    try {
      devices = await deps.enumerateDevices();
      available = availableInputs(devices);
    } catch {
      // Without a device list, saved devices are tried as they are.
    }
    const failures: RecordingFailure[] = [];
    const skipped: string[] = [];
    const opened = await Promise.all(
      trackIds.map(async (trackId) => {
        // The browser's default opens on the device it names, as the
        // preview does, rather than leaving the choice to getUserMedia.
        const constraints = getRecordMediaConstraints(
          withBrowserDefaults(deps.resolveInputs(trackId, available), devices),
        );
        if (!constraints) {
          skipped.push(trackId);
          return null;
        }
        try {
          const stream = await deps.getUserMedia(constraints);
          return { trackId, stream };
        } catch (error) {
          failures.push({ trackId, message: describeError(error) });
          return null;
        }
      }),
    );

    const takes: TakeState[] = [];
    for (const entry of opened) {
      if (!entry) continue;
      const { trackId, stream } = entry;
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      try {
        const mimeType = pickRecorderMimeType(
          hasVideo,
          hasAudio,
          deps.isTypeSupported,
        );
        const recorder = deps.createRecorder(
          stream,
          mimeType ? { mimeType } : {},
        );
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        let markStopped = () => {};
        const stopped = new Promise<void>((resolve) => {
          markStopped = resolve;
        });
        recorder.onstop = () => markStopped();
        takes.push({
          trackId,
          stream,
          hasVideo,
          hasAudio,
          recorder,
          chunks,
          stopped,
          markStopped,
          stopRequested: false,
        });
      } catch (error) {
        stopStream(stream);
        failures.push({ trackId, message: describeError(error) });
      }
    }

    const session = new RecordingSession(takes, deps, callbacks);
    for (const take of takes) {
      session.watch(take);
    }
    return { session, failures, skipped };
  }

  /** The tracks being recorded, with their live streams. */
  getTakes(): readonly RecordingTake[] {
    return this.takes;
  }

  get isEmpty() {
    return this.takes.length === 0;
  }

  /** Starts every recorder together; returns when, by `deps.now()`. */
  start() {
    this.startedAt = this.deps.now();
    for (const take of this.takes) {
      try {
        take.recorder.start(RECORDER_TIMESLICE_MS);
      } catch (error) {
        this.endTake(take, describeError(error));
      }
    }
    return this.startedAt;
  }

  /** Seconds since `start()`. */
  elapsedSeconds() {
    return Math.max(0, (this.deps.now() - this.startedAt) / 1000);
  }

  /**
   * Stops every recorder and releases the devices. Resolves with each
   * track's recording; tracks that captured nothing are left out.
   */
  async stop(): Promise<FinishedTake[]> {
    if (this.finished) return [];
    this.finished = true;
    const endedAt = this.elapsedSeconds();
    for (const take of this.takes) {
      stopRecorder(take);
    }
    await Promise.all(this.takes.map((take) => take.stopped));
    for (const take of this.takes) {
      stopStream(take.stream);
    }
    return this.takes.flatMap((take) => {
      if (!take.chunks.length) return [];
      const mimeType =
        take.recorder.mimeType || take.chunks[0]?.type || "video/webm";
      return [
        {
          trackId: take.trackId,
          blob: new Blob(take.chunks, { type: mimeType }),
          mimeType,
          hasVideo: take.hasVideo,
          durationSeconds: take.endedAtSeconds ?? endedAt,
        },
      ];
    });
  }

  private watch(take: TakeState) {
    take.recorder.onerror = (event) => {
      const error =
        event && typeof event === "object" && "error" in event
          ? (event as { error: unknown }).error
          : event;
      this.endTake(take, describeError(error));
    };
    for (const track of take.stream.getTracks()) {
      track.addEventListener("ended", () => {
        this.endTake(take, "its camera or microphone was disconnected");
      });
    }
  }

  private endTake(take: TakeState, message: string) {
    if (this.finished || take.endedAtSeconds !== undefined) return;
    take.endedAtSeconds = this.elapsedSeconds();
    stopRecorder(take);
    stopStream(take.stream);
    this.callbacks.onTrackEnded?.(take.trackId, message);
  }
}

// Stops `take`'s recorder once; its last data arrives before `onstop`.
function stopRecorder(take: TakeState) {
  if (take.stopRequested) return;
  take.stopRequested = true;
  if (take.recorder.state === "inactive") {
    // It never started, so nothing more will arrive.
    take.markStopped();
    return;
  }
  try {
    take.recorder.stop();
  } catch {
    take.markStopped();
  }
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** The browser's MediaRecorder and mediaDevices, for the app. */
export function getBrowserRecordingDeps(
  resolveInputs: RecordingDeps["resolveInputs"],
): RecordingDeps | null {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  const Recorder = globalThis.MediaRecorder;
  if (!mediaDevices?.getUserMedia || !Recorder) {
    return null;
  }
  return {
    enumerateDevices: () => mediaDevices.enumerateDevices(),
    getUserMedia: (constraints) => mediaDevices.getUserMedia(constraints),
    isTypeSupported: (type) => Recorder.isTypeSupported(type),
    createRecorder: (stream, options) =>
      new Recorder(stream, options) as unknown as MediaRecorderLike,
    resolveInputs,
    now: () => performance.now(),
  };
}
