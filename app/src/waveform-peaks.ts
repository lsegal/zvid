// Real audio peaks for the main audio lane. Every decoded sample of every
// channel is folded into fixed-duration min/max buckets so the lane can draw
// the actual signal at any zoom level.

export const PEAK_BUCKETS_PER_SECOND = 200;

export type WaveformPeaks = {
  bucketsPerSecond: number;
  durationSeconds: number;
  min: Float32Array;
  max: Float32Array;
};

export type WaveformPeaksResult =
  | { status: "ready"; peaks: WaveformPeaks }
  | { status: "no-audio" };

type AudioChunk = {
  timestamp: number;
  sampleRate: number;
  frameCount: number;
  channels: Float32Array[];
};

export class PeakAccumulator {
  private min: Float32Array;
  private max: Float32Array;
  private bucketCount = 0;
  private endSeconds = 0;
  private readonly bucketsPerSecond: number;

  constructor(
    bucketsPerSecond = PEAK_BUCKETS_PER_SECOND,
    estimatedDurationSeconds = 0,
  ) {
    this.bucketsPerSecond = bucketsPerSecond;
    const capacity = Math.max(
      1,
      Math.ceil(Math.max(0, estimatedDurationSeconds) * bucketsPerSecond) + 1,
    );
    this.min = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
  }

  add({ timestamp, sampleRate, frameCount, channels }: AudioChunk) {
    if (!frameCount || !channels.length || sampleRate <= 0) {
      return;
    }

    const bucketsPerFrame = this.bucketsPerSecond / sampleRate;
    const firstBucket = timestamp * this.bucketsPerSecond;
    const chunkEnd = timestamp + frameCount / sampleRate;
    this.ensureCapacity(Math.ceil(chunkEnd * this.bucketsPerSecond) + 1);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const bucket = Math.floor(firstBucket + frame * bucketsPerFrame);
      if (bucket < 0) {
        continue;
      }

      let low = this.min[bucket] ?? 0;
      let high = this.max[bucket] ?? 0;
      for (const channel of channels) {
        const value = channel[frame] ?? 0;
        if (value < low) {
          low = value;
        } else if (value > high) {
          high = value;
        }
      }
      this.min[bucket] = low;
      this.max[bucket] = high;
      this.bucketCount = Math.max(this.bucketCount, bucket + 1);
    }

    this.endSeconds = Math.max(this.endSeconds, chunkEnd);
  }

  finish(): WaveformPeaks {
    return {
      bucketsPerSecond: this.bucketsPerSecond,
      durationSeconds: this.endSeconds,
      min: this.min.slice(0, this.bucketCount),
      max: this.max.slice(0, this.bucketCount),
    };
  }

  private ensureCapacity(capacity: number) {
    if (capacity <= this.min.length) {
      return;
    }

    const nextCapacity = Math.max(capacity, this.min.length * 2);
    const min = new Float32Array(nextCapacity);
    const max = new Float32Array(nextCapacity);
    min.set(this.min);
    max.set(this.max);
    this.min = min;
    this.max = max;
  }
}

// Decodes the whole primary audio track. Runs in the peaks worker, and on the
// main thread only when workers are unavailable, so it yields between chunks.
export async function decodeWaveformPeaks(
  blob: Blob,
  options?: { yieldEvery?: number },
): Promise<WaveformPeaksResult> {
  const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import(
    "mediabunny"
  );
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob),
  });

  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      return { status: "no-audio" };
    }

    const accumulator = new PeakAccumulator(
      PEAK_BUCKETS_PER_SECOND,
      await track.computeDuration(),
    );
    const sink = new AudioSampleSink(track);
    const yieldEvery = options?.yieldEvery ?? 0;
    let chunkIndex = 0;
    let channels: Float32Array[] = [];

    for await (const sample of sink.samples()) {
      try {
        const frameCount = sample.numberOfFrames;
        if (
          channels.length !== sample.numberOfChannels ||
          (channels[0]?.length ?? 0) < frameCount
        ) {
          channels = Array.from(
            { length: sample.numberOfChannels },
            () => new Float32Array(frameCount),
          );
        }
        for (let plane = 0; plane < sample.numberOfChannels; plane += 1) {
          sample.copyTo(channels[plane] as Float32Array, {
            planeIndex: plane,
            format: "f32-planar",
          });
        }
        accumulator.add({
          timestamp: sample.timestamp,
          sampleRate: sample.sampleRate,
          frameCount,
          channels,
        });
      } finally {
        sample.close();
      }

      chunkIndex += 1;
      if (yieldEvery > 0 && chunkIndex % yieldEvery === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const peaks = accumulator.finish();
    return peaks.min.length
      ? { status: "ready", peaks }
      : { status: "no-audio" };
  } finally {
    input.dispose();
  }
}

// Returns the [min, max] envelope of every bucket overlapping the given time
// range, or null when the range lies outside the decoded audio.
export function getPeakRange(
  peaks: WaveformPeaks,
  startSeconds: number,
  endSeconds: number,
): [number, number] | null {
  const count = peaks.min.length;
  const first = Math.max(0, Math.floor(startSeconds * peaks.bucketsPerSecond));
  const last = Math.min(
    count,
    Math.max(first + 1, Math.ceil(endSeconds * peaks.bucketsPerSecond)),
  );
  if (first >= count || last <= first) {
    return null;
  }

  let low = 0;
  let high = 0;
  for (let bucket = first; bucket < last; bucket += 1) {
    low = Math.min(low, peaks.min[bucket] ?? 0);
    high = Math.max(high, peaks.max[bucket] ?? 0);
  }
  return [low, high];
}
