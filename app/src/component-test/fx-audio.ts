import { SIGNATURES } from "../app/constants.ts";
import type { ProjectState } from "../app/types.ts";
import { type DecodedAudio, renderAudioMix } from "../audio-mix/mix.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";

// Test signals and measurements for audio effects. The mix renders through
// the same resolve and chain code the preview's mixer and the export use,
// offline, so a test reads what a clip's effects do to its sound without
// playing it in real time.

// A mono signal of `seconds` at `sampleRate`, sample by sample.
export function signal(
  seconds: number,
  sampleRate: number,
  sampleAt: (index: number, seconds: number) => number,
): DecodedAudio {
  const frames = Math.round(seconds * sampleRate);
  const channel = new Float32Array(frames);
  for (let index = 0; index < frames; index++) {
    channel[index] = sampleAt(index, index / sampleRate);
  }
  return { sampleRate, channels: [channel] };
}

// The e2e specs' 16-bit WAVs, quantized the same way.
const quantize = (sample: number) => Math.round(sample * 32767) / 32767;

// A 440 Hz tone at 8 kHz, about −21 dBFS.
export function tone(seconds: number, hz = 440, peak = 3000 / 32767) {
  return signal(seconds, 8000, (_, t) =>
    quantize(peak * Math.sin(2 * Math.PI * hz * t)),
  );
}

// Seeded white noise at 8 kHz.
export function noise(seconds: number, peak = 0.3) {
  let seed = 11;
  return signal(seconds, 8000, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return quantize((seed / 2 ** 31 - 1) * peak);
  });
}

// A 400 Hz tone struck ten times a second, each hit decaying in 30 ms.
export function hits(seconds: number, peak = 10_000 / 32767) {
  return signal(seconds, 8000, (index, t) => {
    const age = (index % 800) / 8000;
    return quantize(
      peak * Math.sin(2 * Math.PI * 400 * t) * Math.exp(-age / 0.03),
    );
  });
}

// 300 Hz and 6 kHz in equal parts at 48 kHz: a voice's body and its "s".
export function sibilant(seconds: number) {
  return signal(seconds, 48_000, (_, t) =>
    quantize(
      0.1 * Math.sin(2 * Math.PI * 300 * t) +
        0.1 * Math.sin(2 * Math.PI * 6000 * t),
    ),
  );
}

// One tone for the first half and another for the second.
export function twoPart(
  seconds: number,
  first: { hz: number; peak: number },
  second: { hz: number; peak: number },
) {
  const frames = Math.round(seconds * 8000);
  return signal(seconds, 8000, (index, t) => {
    const { hz, peak } = index < frames / 2 ? first : second;
    return quantize(peak * Math.sin(2 * Math.PI * hz * t));
  });
}

// A 16-bit PCM WAV file of `audio`, as a dropped file would be.
export function wavBlob({ sampleRate, channels }: DecodedAudio) {
  const frames = channels[0]?.length ?? 0;
  const bytes = new DataView(new ArrayBuffer(44 + frames * channels.length * 2));
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      bytes.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, "RIFF");
  bytes.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, channels.length, true);
  bytes.setUint32(24, sampleRate, true);
  bytes.setUint32(28, sampleRate * channels.length * 2, true);
  bytes.setUint16(32, channels.length * 2, true);
  bytes.setUint16(34, 16, true);
  ascii(36, "data");
  bytes.setUint32(40, frames * channels.length * 2, true);
  for (let frame = 0; frame < frames; frame++) {
    channels.forEach((channel, index) => {
      const sample = Math.max(-1, Math.min(1, channel[frame]));
      bytes.setInt16(
        44 + (frame * channels.length + index) * 2,
        Math.round(sample * 32767),
        true,
      );
    });
  }
  return new Blob([bytes.buffer], { type: "audio/wav" });
}

export type MixWindow = {
  // The timeline second the window starts at.
  startSeconds: number;
  seconds: number;
  sampleRate?: number;
};

// What the project's mix plays over a window, after every clip's, bus's and
// Global effect and the master limiter, with `audio` as each media item's
// decoded sound.
export function renderProjectMix(
  project: ProjectState,
  audio: ReadonlyMap<string, DecodedAudio>,
  { startSeconds, seconds, sampleRate = 48_000 }: MixWindow,
) {
  const mix = resolveAudioClips({
    clips: project.clips,
    lanes: project.lanes,
    sourceTracks: project.sourceTracks,
    sourceSpans: project.sourceSpans,
    mediaById: new Map(project.mediaItems.map((item) => [item.id, item])),
    effects: project.effects,
    bpm: project.bpm,
    signature: SIGNATURES.find(({ id }) => id === project.signatureId),
  });
  return renderAudioMix(mix, audio, {
    sampleRate,
    numberOfChannels: 2,
    startSeconds,
    length: Math.round(seconds * sampleRate),
  });
}

// The RMS level of every channel's samples together.
export function rms(channels: readonly Float32Array[]) {
  let total = 0;
  let count = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      total += sample * sample;
    }
    count += channel.length;
  }
  return count ? Math.sqrt(total / count) : 0;
}

// The power spectrum of the first channel's first `size` samples, through
// a Blackman window as an AnalyserNode applies, one value per bin.
export function powerSpectrum(channel: Float32Array, size = 2048) {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let index = 0; index < size; index++) {
    const phase = (2 * Math.PI * index) / size;
    const window = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
    re[index] = (channel[index] ?? 0) * window;
  }
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let k = 0; k < length / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = start + k;
        const b = a + length / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const power = new Float64Array(size / 2);
  for (let bin = 0; bin < size / 2; bin++) {
    power[bin] = re[bin] * re[bin] + im[bin] * im[bin];
  }
  return power;
}

// The share of the first channel's power above `hz`.
export function shareAbove(
  channels: readonly Float32Array[],
  sampleRate: number,
  hz: number,
  size = 2048,
) {
  const power = powerSpectrum(channels[0], size);
  const binHz = sampleRate / size;
  let all = 0;
  let high = 0;
  power.forEach((value, bin) => {
    all += value;
    if (bin * binHz > hz) {
      high += value;
    }
  });
  return all > 0 ? high / all : 0;
}

// The frequency of the first channel's strongest bin.
export function dominantFrequency(
  channels: readonly Float32Array[],
  sampleRate: number,
  size = 4096,
) {
  const power = powerSpectrum(channels[0], size);
  let best = 1;
  for (let bin = 2; bin < power.length; bin++) {
    if (power[bin] > power[best]) {
      best = bin;
    }
  }
  return (best * sampleRate) / size;
}
