// The Audio row's waveform: the peaks of every clip that renders audio,
// mapped onto song time, scaled by its Gain and summed per bucket. It draws
// the same mix playback and export play, without decoding it again.
import { pluralize } from "./app/util.ts";
import {
  PEAK_BUCKETS_PER_SECOND,
  type WaveformPeaks,
} from "./waveform-peaks.ts";

export type MixPeaksClip = {
  peaks: WaveformPeaks;
  // Song seconds the clip renders over.
  startSeconds: number;
  endSeconds: number;
  // Linear gain; 0 is silent.
  amplitude: number;
  // The source seconds the clip plays at a song time, or null where it is
  // silent, such as outside its source window.
  sourceSecondsAt: (songSeconds: number) => number | null;
};

// Where the mix comes from: layer clips when any of them has audio, else
// source clips.
export type AudioMixOrigin = "layers" | "source-tracks";

// The Audio row's label under "Audio".
export function describeAudioMix(origin: AudioMixOrigin, clipCount: number) {
  if (!clipCount) {
    return "No audio";
  }
  const from = origin === "layers" ? "From layers" : "From source tracks";
  return `${from} · ${pluralize(clipCount, "clip")}`;
}

// Min and max of a clip's source peaks over [fromSeconds, toSeconds), so a
// clip played faster than 1× keeps its loudest samples.
function readPeakRange(
  peaks: WaveformPeaks,
  fromSeconds: number,
  toSeconds: number,
) {
  const count = Math.min(peaks.min.length, peaks.max.length);
  const first = Math.max(0, Math.floor(fromSeconds * peaks.bucketsPerSecond));
  const last = Math.min(
    count,
    Math.max(first + 1, Math.ceil(toSeconds * peaks.bucketsPerSecond)),
  );
  if (first >= last) {
    return null;
  }

  let low = 0;
  let high = 0;
  for (let bucket = first; bucket < last; bucket += 1) {
    low = Math.min(low, peaks.min[bucket] ?? 0);
    high = Math.max(high, peaks.max[bucket] ?? 0);
  }
  return { low, high };
}

// Sums the clips' scaled peaks into one waveform over song time, or returns
// null when no clip renders audio. Clips at zero gain still count, so a muted
// mix draws flat rather than disappearing.
export function mixWaveformPeaks(
  clips: readonly MixPeaksClip[],
  bucketsPerSecond = PEAK_BUCKETS_PER_SECOND,
): WaveformPeaks | null {
  const audible = clips.filter(
    (clip) =>
      clip.endSeconds > clip.startSeconds && Number.isFinite(clip.endSeconds),
  );
  if (!audible.length) {
    return null;
  }

  const durationSeconds = Math.max(
    0,
    ...audible.map((clip) => clip.endSeconds),
  );
  const bucketCount = Math.ceil(durationSeconds * bucketsPerSecond);
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  const bucketSeconds = 1 / bucketsPerSecond;

  for (const clip of audible) {
    if (!(clip.amplitude > 0)) {
      continue;
    }

    const first = Math.max(0, Math.floor(clip.startSeconds * bucketsPerSecond));
    const last = Math.min(
      bucketCount,
      Math.ceil(clip.endSeconds * bucketsPerSecond),
    );
    for (let bucket = first; bucket < last; bucket += 1) {
      const songStart = Math.max(clip.startSeconds, bucket * bucketSeconds);
      const songEnd = Math.min(clip.endSeconds, songStart + bucketSeconds);
      const sourceStart = clip.sourceSecondsAt(songStart);
      const sourceEnd = clip.sourceSecondsAt(songEnd);
      if (sourceStart === null) {
        continue;
      }

      const range = readPeakRange(
        clip.peaks,
        Math.min(sourceStart, sourceEnd ?? sourceStart),
        Math.max(sourceStart, sourceEnd ?? sourceStart),
      );
      if (range) {
        min[bucket] += range.low * clip.amplitude;
        max[bucket] += range.high * clip.amplitude;
      }
    }
  }

  return { bucketsPerSecond, durationSeconds, min, max };
}
