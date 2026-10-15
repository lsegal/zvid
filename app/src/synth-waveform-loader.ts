// Waveform peaks of MIDI clips' performances, which the Audio row mixes in
// like media's peaks (see useAudioMix). A clip's notes render through its
// instrument exactly as the mix and export render them (see renderSynthClip
// in audio-mix/synth.ts), at export's rate, in an OfflineAudioContext. That
// renders on its own thread but is not available in workers, so only the
// fold into peaks runs in a worker. Clips render one at a time, so many
// clips building at once do not compete. Peaks are kept per performance
// media id, which changes whenever the notes, instrument or tempo do.
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
// The most performances whose peaks are kept, least recently used first out.
const MAX_ENTRIES = 64;

const NO_WAVEFORM: WaveformPeaksResult = { status: "no-audio" };

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
  private readonly render: RenderSynth;
  private readonly createWorker: () => Worker;
  private readonly entries = new Map<string, Promise<WaveformPeaksResult>>();
  private readonly pendingRequests = new Map<
    number,
    (result: WaveformPeaksResult) => void
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private worker: Worker | null = null;
  private workerUnavailable = false;
  private nextRequestId = 1;

  constructor(
    render: RenderSynth = renderSynthClip,
    createWorker: () => Worker = createPeaksWorker,
  ) {
    this.render = render;
    this.createWorker = createWorker;
  }

  /**
   * The peaks of `synth`, played as `mediaId` at `bpm`, rendering it unless
   * they are kept or already on their way. Without the worker, there are
   * none, and the clip is left out of the waveform.
   */
  load(
    mediaId: string,
    synth: SynthClip,
    bpm: number,
  ): Promise<WaveformPeaksResult> {
    const kept = this.entries.get(mediaId);
    const peaks =
      kept ??
      this.queue.then(() =>
        this.workerUnavailable ? NO_WAVEFORM : this.computePeaks(synth, bpm),
      );
    // Most recently used last.
    this.entries.delete(mediaId);
    this.entries.set(mediaId, peaks);
    if (!kept) {
      this.queue = peaks.catch(() => undefined);
      peaks.catch(() => {
        if (this.entries.get(mediaId) === peaks) {
          this.entries.delete(mediaId);
        }
      });
      for (const [oldest] of [...this.entries].slice(0, -MAX_ENTRIES)) {
        this.entries.delete(oldest);
      }
    }
    return peaks;
  }

  private async computePeaks(
    synth: SynthClip,
    bpm: number,
  ): Promise<WaveformPeaksResult> {
    if (!this.getWorker()) {
      return NO_WAVEFORM;
    }
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

/** The loader the Audio row shares across mixes. */
export function sharedSynthWaveformLoader() {
  shared ??= new SynthWaveformLoader();
  return shared;
}
