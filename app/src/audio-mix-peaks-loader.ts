// Mixes the Audio row's waveform in a worker, so rebuilding it after an edit
// never blocks the main thread. Where the worker cannot load (e.g. a
// restrictive webview), it mixes here after yielding to the event loop.
import { toMixPeaksClip } from "./audio-mix-clips";
import { mixWaveformPeaks } from "./audio-mix-peaks";
import type {
  MixPeaksRequest,
  MixPeaksResponse,
  MixPeaksSource,
} from "./audio-mix-peaks.worker";
import type { WaveformPeaks } from "./waveform-peaks";

const pendingRequests = new Map<
  number,
  {
    resolve: (peaks: WaveformPeaks | null) => void;
    reject: (error: Error) => void;
  }
>();
let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;

function getWorker() {
  if (worker || workerUnavailable) {
    return worker;
  }

  try {
    worker = new Worker(
      new URL("./audio-mix-peaks.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
  } catch {
    workerUnavailable = true;
    return null;
  }

  worker.onmessage = (event: MessageEvent<MixPeaksResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(event.data.id);
    if ("error" in event.data) {
      pending.reject(new Error(event.data.error));
      return;
    }
    pending.resolve(event.data.peaks);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    worker?.terminate();
    worker = null;
    workerUnavailable = true;
    const error = new Error("Audio mix worker failed to start");
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
  };
  return worker;
}

function mixHere(clips: readonly MixPeaksSource[]) {
  return new Promise<WaveformPeaks | null>((resolve) => {
    setTimeout(() =>
      resolve(
        mixWaveformPeaks(clips.map((clip) => toMixPeaksClip(clip, clip.peaks))),
      ),
    );
  });
}

// The mix of the clips' peaks (see mixWaveformPeaks). Their peaks are copied
// to the worker, not transferred, since the waveform loader keeps them.
export async function mixWaveformPeaksInBackground(
  clips: MixPeaksSource[],
): Promise<WaveformPeaks | null> {
  const target = getWorker();
  if (!target) {
    return mixHere(clips);
  }

  try {
    return await new Promise<WaveformPeaks | null>((resolve, reject) => {
      const id = nextRequestId;
      nextRequestId += 1;
      pendingRequests.set(id, { resolve, reject });
      target.postMessage({ id, clips } satisfies MixPeaksRequest);
    });
  } catch (error) {
    if (!workerUnavailable) {
      throw error;
    }
    return mixHere(clips);
  }
}
