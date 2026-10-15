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
import { renderSynthClip, type SynthClip } from "./audio-mix/synth.ts";
import type {
  SynthWaveformRequest,
  SynthWaveformResponse,
} from "./synth-waveform.worker";
import type { WaveformPeaksResult } from "./waveform-peaks";

// Peaks keep 200 buckets a second, so the render needs far less than the
// mix's rate; the envelope it draws is the same.
export const SYNTH_WAVEFORM_SAMPLE_RATE = 22050;
// Settled peaks kept for clips no longer drawn, as when an edit is undone.
const MAX_IDLE_ENTRIES = 64;

const NO_WAVEFORM: WaveformPeaksResult = { status: "no-audio" };

type Entry = {
  peaks: Promise<WaveformPeaksResult>;
  holders: number;
  started: boolean;
  settled: boolean;
};

const entries = new Map<string, Entry>();
const pendingRequests = new Map<
  number,
  (result: WaveformPeaksResult) => void
>();
let queue: Promise<unknown> = Promise.resolve();
let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;

function getWorker() {
  if (worker || workerUnavailable) {
    return worker;
  }
  try {
    worker = new Worker(
      new URL("./synth-waveform.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    workerUnavailable = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<SynthWaveformResponse>) => {
    const resolve = pendingRequests.get(event.data.id);
    pendingRequests.delete(event.data.id);
    resolve?.(event.data.result);
  };
  // Without the worker, clips keep their note thumbnails.
  worker.onerror = (event) => {
    event.preventDefault();
    worker?.terminate();
    worker = null;
    workerUnavailable = true;
    for (const resolve of pendingRequests.values()) {
      resolve(NO_WAVEFORM);
    }
    pendingRequests.clear();
  };
  return worker;
}

async function computePeaks(
  entry: Entry,
  synth: SynthClip,
  bpm: number,
): Promise<WaveformPeaksResult> {
  if (!entry.holders || !getWorker()) {
    return NO_WAVEFORM;
  }
  entry.started = true;
  const audio = await renderSynthClip(synth, bpm, SYNTH_WAVEFORM_SAMPLE_RATE);
  const target = getWorker();
  if (!target) {
    return NO_WAVEFORM;
  }
  return new Promise((resolve) => {
    const id = nextRequestId;
    nextRequestId += 1;
    pendingRequests.set(id, resolve);
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

// Drops the least recently used settled peaks no clip holds past the limit.
function evictIdleEntries() {
  const idle = [...entries].filter(
    ([, entry]) => entry.settled && !entry.holders,
  );
  for (const [mediaId] of idle.slice(0, -MAX_IDLE_ENTRIES)) {
    entries.delete(mediaId);
  }
}

/**
 * The peaks of `synth`, played as `mediaId` at `bpm`, rendering it unless
 * they are kept or already on their way. Call `release` once they are no
 * longer wanted: a render nothing holds is dropped before it starts.
 */
export function requestSynthWaveformPeaks(
  mediaId: string,
  synth: SynthClip,
  bpm: number,
) {
  let entry = entries.get(mediaId);
  if (entry) {
    // Most recently used last.
    entries.delete(mediaId);
  } else {
    const created: Entry = {
      peaks: Promise.resolve(NO_WAVEFORM),
      holders: 0,
      started: false,
      settled: false,
    };
    created.peaks = queue.then(() => computePeaks(created, synth, bpm));
    queue = created.peaks.catch(() => undefined);
    created.peaks.then(
      () => {
        created.settled = true;
        // A render dropped before it started is not kept.
        if (!created.started && entries.get(mediaId) === created) {
          entries.delete(mediaId);
        }
        evictIdleEntries();
      },
      () => {
        if (entries.get(mediaId) === created) {
          entries.delete(mediaId);
        }
      },
    );
    entry = created;
  }
  entries.set(mediaId, entry);
  const held = entry;
  held.holders += 1;
  let released = false;
  return {
    peaks: held.peaks,
    release() {
      if (released) {
        return;
      }
      released = true;
      held.holders -= 1;
      if (!held.holders && !held.started && entries.get(mediaId) === held) {
        entries.delete(mediaId);
      }
    },
  };
}
