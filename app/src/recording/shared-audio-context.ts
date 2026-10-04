// One AudioContext for every input analyser: the device panels' VU meters
// and the live clips' waveforms read their microphones through it rather
// than each opening a context of its own. It is suspended while nothing
// uses it.

// The parts of an AudioContext sharing it needs, so tests can stand one in.
type ContextLike = {
  readonly state: string;
  resume(): Promise<void>;
  suspend(): Promise<void>;
};

export class SharedAudioContext<Context extends ContextLike> {
  private readonly create: () => Context;
  private context: Context | null = null;
  private users = 0;

  constructor(create: () => Context) {
    this.create = create;
  }

  /** The shared context, running; hand it back with `release`. */
  acquire(): Context {
    if (!this.context || this.context.state === "closed") {
      this.context = this.create();
    }
    this.users += 1;
    void this.context.resume().catch(() => {
      // It starts once the page has had a gesture.
    });
    return this.context;
  }

  release() {
    this.users = Math.max(0, this.users - 1);
    if (!this.users && this.context) {
      void this.context.suspend().catch(() => {});
    }
  }

  /** How many are using the context, for tests. */
  get userCount() {
    return this.users;
  }
}

/** The app's shared analysis context. */
export const analysisAudioContext = new SharedAudioContext(
  () => new AudioContext(),
);
