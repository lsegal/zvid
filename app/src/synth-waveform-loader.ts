// Waveform peaks of MIDI clips, drawn on the timeline in place of their note
// thumbnails. A clip's notes render through its instrument exactly as the
// mix and export render them (see renderSynthClip in audio-mix/synth.ts),
// in an OfflineAudioContext, which renders on its own thread but is not
// available in workers; the rendered audio is then folded into peaks in a
// worker. Clips render one at a time, so many clips building at once do not
// compete, and a render no clip waits for any more is dropped before it
// starts, so a burst of edits renders only the latest. Peaks are kept per
// performance media id, which changes whenever the notes, instrument or
// tempo do.
import type { DecodedAudio } from "./audio-mix/mix.ts";
import { renderSynthClip, type SynthClip } from "./audio-mix/synth.ts";
import { DEFAULT_SESSION_ENCODING } from "./session-settings.ts";
import type {
  SynthWaveformRequest,
  SynthWaveformResponse,
} from "./synth-waveform.worker";
import type { WaveformPeaksResult } from "./waveform-peaks";

// Export's default rate. Renders are quick even so, and lower rates lose
// the peaks of the Drum Rack's transients.
export const SYNTH_WAVEFORM_SAMPLE_RATE =
  DEFAULT_SESSION_ENCODING.audioSampleRate;
// Settled peaks kept for clips no longer drawn, as when an edit is undone.
const MAX_IDLE_ENTRIES = 64;

const NO_WAVEFORM: WaveformPeaksResult = { status: "no-audio" };

type Entry = {
  peaks: Promise<WaveformPeaksResult>;
  holders: number;
  started: boolean;
  settled: boolean;
};

// Peaks requested for a clip: `release` them once they are no longer wanted.
export type SynthWaveformRequestHandle = {
  peaks: Promise<WaveformPeaksResult>;
  release(): void;
};

type RenderSynth = (
  synth: SynthClip,
  bpm: number,
  sampleRate: number,
) => Promise<DecodedAudio>;

function createPeaksWorker() {
  return new Worker(new URL("./synth-waveform.worker.ts", import.meta.url), {
    type: "module",
  });
}

export class SynthWaveformLoader {
  private readonly entries = new Map<string, Entry>();
  private readonly pendingRequests = new Map<
    number,
    (result: WaveformPeaksResult) => void
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private worker: Worker | null = null;
  private workerUnavailable = false;
  private nextRequestId = 1;

  private readonly render: RenderSynth;
  private readonly createWorker: () => Worker;

  constructor(
    render: RenderSynth = renderSynthClip,
    createWorker: () => Worker = createPeaksWorker,
  ) {
    this.render = render;
    this.createWorker = createWorker;
  }

  /**
   * The peaks of `synth`, played as `mediaId` at `bpm`, rendering it unless
   * they are kept or already on their way. A render nothing holds any more
   * is dropped before it starts.
   */
  request(
    mediaId: string,
    synth: SynthClip,
    bpm: number,
  ): SynthWaveformRequestHandle {
    const entry =
      this.entries.get(mediaId) ?? this.queueRender(mediaId, synth, bpm);
    // Most recently used last.
    this.entries.delete(mediaId);
    this.entries.set(mediaId, entry);
    entry.holders += 1;
    let released = false;
    return {
      peaks: entry.peaks,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        entry.holders -= 1;
        if (!entry.holders && !entry.started) {
          this.forget(mediaId, entry);
        }
      },
    };
  }

  private queueRender(mediaId: string, synth: SynthClip, bpm: number) {
    const entry: Entry = {
      peaks: Promise.resolve(NO_WAVEFORM),
      holders: 0,
      started: false,
      settled: false,
    };
    entry.peaks = this.queue.then(() => this.computePeaks(entry, synth, bpm));
    this.queue = entry.peaks.catch(() => undefined);
    entry.peaks.then(
      () => {
        entry.settled = true;
        // A render dropped before it started is not kept.
        if (!entry.started) {
          this.forget(mediaId, entry);
        }
        this.evictIdleEntries();
      },
      () => this.forget(mediaId, entry),
    );
    return entry;
  }

  private forget(mediaId: string, entry: Entry) {
    if (this.entries.get(mediaId) === entry) {
      this.entries.delete(mediaId);
    }
  }

  // Drops the least recently used settled peaks no clip holds past the limit.
  private evictIdleEntries() {
    const idle = [...this.entries].filter(
      ([, entry]) => entry.settled && !entry.holders,
    );
    for (const [mediaId] of idle.slice(0, -MAX_IDLE_ENTRIES)) {
      this.entries.delete(mediaId);
    }
  }

  private async computePeaks(
    entry: Entry,
    synth: SynthClip,
    bpm: number,
  ): Promise<WaveformPeaksResult> {
    if (!entry.holders || !this.getWorker()) {
      return NO_WAVEFORM;
    }
    entry.started = true;
    const audio = await this.render(synth, bpm, SYNTH_WAVEFORM_SAMPLE_RATE);
    const target = this.getWorker();
    if (!target) {
      return NO_WAVEFORM;
    }
    return new Promise((resolve) => {
      const id = this.nextRequestId;
      this.nextRequestId += 1;
      this.pendingRequests.set(id, resolve);
      target.postMessage(
        {
          id,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
        } satisfies SynthWaveformRequest,
        { transfer: audio.channels.map((channel) => channel.buffer) },
      );
    });
  }

  private getWorker() {
    if (this.worker || this.workerUnavailable) {
      return this.worker;
    }
    let worker: Worker;
    try {
      worker = this.createWorker();
    } catch {
      this.workerUnavailable = true;
      return null;
    }
    worker.onmessage = (event: MessageEvent<SynthWaveformResponse>) => {
      const resolve = this.pendingRequests.get(event.data.id);
      this.pendingRequests.delete(event.data.id);
      resolve?.(event.data.result);
    };
    // Without the worker, clips keep their note thumbnails.
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      this.worker = null;
      this.workerUnavailable = true;
      for (const resolve of this.pendingRequests.values()) {
        resolve(NO_WAVEFORM);
      }
      this.pendingRequests.clear();
    };
    this.worker = worker;
    return worker;
  }
}

let shared: SynthWaveformLoader | null = null;

/** The loader every timeline clip shares. */
export function sharedSynthWaveformLoader() {
  shared ??= new SynthWaveformLoader();
  return shared;
}
