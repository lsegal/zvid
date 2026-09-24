import { cacheWaveformPeaks, getCachedWaveformPeaks } from "./media-cache";
import {
  decodeWaveformPeaks,
  type WaveformPeaksResult,
} from "./waveform-peaks";
import type {
  WaveformPeaksRequest,
  WaveformPeaksResponse,
} from "./waveform-peaks.worker";

const memoryCache = new Map<string, Promise<WaveformPeaksResult>>();
const pendingRequests = new Map<
  number,
  {
    resolve: (result: WaveformPeaksResult) => void;
    reject: (error: Error) => void;
  }
>();
let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;

function failPendingRequests(error: Error) {
  for (const pending of pendingRequests.values()) {
    pending.reject(error);
  }
  pendingRequests.clear();
}

function getWorker() {
  if (worker || workerUnavailable) {
    return worker;
  }

  try {
    worker = new Worker(
      new URL("./waveform-peaks.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
  } catch {
    workerUnavailable = true;
    return null;
  }

  worker.onmessage = (event: MessageEvent<WaveformPeaksResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(event.data.id);
    if ("error" in event.data) {
      pending.reject(new Error(event.data.error));
      return;
    }
    pending.resolve(event.data.result);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    worker?.terminate();
    worker = null;
    workerUnavailable = true;
    failPendingRequests(new Error("Waveform worker failed to start"));
  };
  return worker;
}

function decodeInWorker(blob: Blob) {
  const target = getWorker();
  if (!target) {
    return null;
  }

  return new Promise<WaveformPeaksResult>((resolve, reject) => {
    const id = nextRequestId;
    nextRequestId += 1;
    pendingRequests.set(id, { resolve, reject });
    target.postMessage({ id, blob } satisfies WaveformPeaksRequest);
  });
}

async function computeWaveformPeaks(mediaId: string, url: string) {
  try {
    const cached = await getCachedWaveformPeaks(mediaId);
    if (cached) {
      return { status: "ready", peaks: cached } satisfies WaveformPeaksResult;
    }
  } catch {
    // The cache is an optimization; decode from the media when it is missing.
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio (${response.status})`);
  }
  const blob = await response.blob();

  let result: WaveformPeaksResult;
  try {
    result =
      (await decodeInWorker(blob)) ??
      (await decodeWaveformPeaks(blob, { yieldEvery: 8 }));
  } catch (error) {
    if (!workerUnavailable) {
      throw error;
    }
    // The worker could not load (e.g. a restrictive webview); decode here in
    // small chunks so the UI keeps responding.
    result = await decodeWaveformPeaks(blob, { yieldEvery: 8 });
  }

  if (result.status === "ready") {
    void cacheWaveformPeaks(mediaId, result.peaks).catch(() => undefined);
  }
  return result;
}

// Loads real peaks for a media item, decoding at most once per media id per
// page load and reusing peaks cached in IndexedDB across reloads.
export function loadWaveformPeaks(mediaId: string, url: string) {
  const existing = memoryCache.get(mediaId);
  if (existing) {
    return existing;
  }

  const pending = computeWaveformPeaks(mediaId, url);
  memoryCache.set(mediaId, pending);
  pending.catch(() => {
    if (memoryCache.get(mediaId) === pending) {
      memoryCache.delete(mediaId);
    }
  });
  return pending;
}
