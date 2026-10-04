// One capture per camera or microphone, shared by everything that shows or
// records it: a track's device previews, its recording and its live clip
// each get clones of the same device track, and the device is released once
// the last clone is.

export type MediaKind = "video" | "audio";

export type SharedMediaDeps = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createStream: (tracks: MediaStreamTrack[]) => MediaStream;
};

type Entry = {
  track: MediaStreamTrack;
  keys: Set<string>;
  users: number;
};

const KINDS: readonly MediaKind[] = ["video", "audio"];

// Which device a constraint asks for: its exact ID, or "default" when the
// browser chooses.
function deviceKey(
  kind: MediaKind,
  constraint: boolean | MediaTrackConstraints | undefined,
) {
  if (!constraint) return null;
  if (constraint === true) return `${kind}:default`;
  const deviceId = constraint.deviceId;
  if (typeof deviceId === "string") return `${kind}:${deviceId}`;
  if (deviceId && typeof deviceId === "object" && !Array.isArray(deviceId)) {
    const exact = (deviceId as ConstrainDOMStringParameters).exact;
    if (typeof exact === "string") return `${kind}:${exact}`;
  }
  return `${kind}:${JSON.stringify(constraint)}`;
}

export class SharedMediaStreams {
  private readonly deps: () => SharedMediaDeps;
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Entry | undefined>>();
  private readonly clones = new WeakMap<MediaStreamTrack, Entry>();

  // `deps` is read on every request, so a stand-in installed after load is
  // still used.
  constructor(deps: () => SharedMediaDeps) {
    this.deps = deps;
  }

  /**
   * A stream of clones of the devices `constraints` asks for, opening only
   * the devices that aren't already captured, in one `getUserMedia` call.
   * Hand it back to `release` rather than stopping its tracks.
   */
  async acquire(constraints: MediaStreamConstraints): Promise<MediaStream> {
    const wanted = KINDS.flatMap((kind) => {
      const key = deviceKey(kind, constraints[kind]);
      return key ? [{ kind, key }] : [];
    });
    const missing = wanted.filter(
      ({ key }) => !this.liveEntry(key) && !this.pending.has(key),
    );
    if (missing.length) {
      const request: MediaStreamConstraints = {};
      for (const { kind } of missing) request[kind] = constraints[kind];
      const opened = this.deps().getUserMedia(request);
      for (const { kind, key } of missing) {
        const registered = opened.then((stream) =>
          this.register(key, kind, stream),
        );
        // Whoever waits on it sees the failure; nobody else needs to.
        registered.catch(() => {});
        this.pending.set(key, registered);
      }
      try {
        await opened;
      } finally {
        for (const { key } of missing) this.pending.delete(key);
      }
    }

    const entries: Entry[] = [];
    for (const { key } of wanted) {
      const entry = this.liveEntry(key) ?? (await this.pending.get(key));
      if (entry?.track.readyState === "live") entries.push(entry);
    }
    const tracks = entries.map((entry) => {
      const clone = entry.track.clone();
      entry.users += 1;
      this.clones.set(clone, entry);
      return clone;
    });
    return this.deps().createStream(tracks);
  }

  /** Stops `stream`'s tracks, releasing each device nothing else uses. */
  release(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      track.stop();
      const entry = this.clones.get(track);
      if (!entry) continue;
      this.clones.delete(track);
      entry.users -= 1;
      if (entry.users <= 0) this.drop(entry);
    }
  }

  /** How many devices are captured, for tests. */
  get openDeviceCount() {
    return new Set(this.entries.values()).size;
  }

  private liveEntry(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.track.readyState !== "live") {
      // The device went away; it is opened afresh next time.
      this.drop(entry);
      return undefined;
    }
    return entry;
  }

  private register(key: string, kind: MediaKind, stream: MediaStream) {
    const track =
      kind === "video"
        ? stream.getVideoTracks()[0]
        : stream.getAudioTracks()[0];
    if (!track) return undefined;
    const entry: Entry = { track, keys: new Set([key]), users: 0 };
    this.entries.set(key, entry);
    // A default device is also found by its own ID, so picking it by name
    // shares the same capture.
    const deviceId = track.getSettings?.().deviceId;
    if (deviceId) {
      const alias = `${kind}:${deviceId}`;
      if (!this.entries.has(alias)) {
        entry.keys.add(alias);
        this.entries.set(alias, entry);
      }
    }
    return entry;
  }

  private drop(entry: Entry) {
    entry.track.stop();
    for (const key of entry.keys) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    }
  }
}

/** The browser's cameras and microphones, shared across the app. */
export const sharedMediaStreams = new SharedMediaStreams(() => ({
  getUserMedia: (constraints) =>
    navigator.mediaDevices.getUserMedia(constraints),
  createStream: (tracks) => new MediaStream(tracks),
}));
