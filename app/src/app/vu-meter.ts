// Levels for the transport bar's stereo VU meter, read from the program mix
// once per animation frame. Everything here is in dBFS: 0 dB is a full-scale
// sample, and silence is -Infinity.
//
// The bars show each channel's sample peak, with release and hold
// ballistics. The readout shows the RMS of both channels (a power average)
// over the last METER_RMS_WINDOW_MS of audio, so a sine reads 3.01 dB below
// its peak and a square wave reads the same as its peak. Each frame measures
// only the samples that arrived since the last one, counting every sample
// exactly once whatever the frame rate.

// The meter's scale: -60 dB at the left, 0 dB, then a short above-0 zone up
// to +6 dB at the right.
export const METER_MIN_DB = -60;
export const METER_MAX_DB = 6;
export const METER_TICKS_DB = [-48, -36, -24, -12, 0] as const;

// The bar falls back with this time constant after a peak.
export const METER_RELEASE_MS = 300;
// The high-water line holds this long, then falls at METER_PEAK_FALL_DB_PER_S.
export const METER_PEAK_HOLD_MS = 1500;
export const METER_PEAK_FALL_DB_PER_S = 30;
// The readout averages this much of the most recent audio.
export const METER_RMS_WINDOW_MS = 300;
// The readout's text for silence, and for anything below the scale.
export const METER_SILENT_TEXT = "-inf dB";

// 20 / ln(10): an exponential decay with time constant T falls this many dB
// per T.
const NEPER_DB = 20 / Math.LN10;

export function amplitudeToDb(amplitude: number) {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

// Where `db` sits along the meter, from 0 (-60 dB and below) to 1 (+6 dB
// and above), on a dB scale.
export function dbToPosition(db: number) {
  if (!(db > METER_MIN_DB)) {
    return 0;
  }
  return Math.min(1, (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB));
}

// The readout's text in dB, with a typographic minus and a plus above 0 dB.
// Below the scale, like silence, it reads "-inf dB", as the bars show empty.
export function formatMeterDb(db: number) {
  if (!(db > METER_MIN_DB)) {
    return METER_SILENT_TEXT;
  }
  // Rounding first keeps a level just below 0 dB from reading "−0.0".
  const tenths = Math.round(db * 10);
  const text = (Math.abs(tenths) / 10).toFixed(1);
  if (tenths < 0) {
    return `−${text} dB`;
  }
  return tenths > 0 ? `+${text} dB` : `${text} dB`;
}

// The largest absolute sample.
export function samplePeak(samples: ArrayLike<number>) {
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  return peak;
}

// Anything below the scale shows as empty.
function floorDb(db: number) {
  return db > METER_MIN_DB ? db : -Infinity;
}

// Fast attack, exponential release: the bar jumps to a louder peak at once
// and falls back from a quieter one.
export function releaseLevel(
  previousDb: number,
  peakDb: number,
  elapsedMs: number,
  reducedMotion = false,
) {
  if (reducedMotion || peakDb >= previousDb) {
    return floorDb(peakDb);
  }
  const released = previousDb - (NEPER_DB * elapsedMs) / METER_RELEASE_MS;
  return floorDb(Math.max(peakDb, released));
}

export type PeakHold = { db: number; heldAtMs: number };

export const EMPTY_PEAK_HOLD: PeakHold = { db: -Infinity, heldAtMs: 0 };

// The high-water line: a higher level moves it at once; otherwise it holds,
// then falls smoothly (or, with reduced motion, drops straight to the level),
// never below the bar.
export function holdPeak(
  hold: PeakHold,
  levelDb: number,
  nowMs: number,
  elapsedMs: number,
  reducedMotion = false,
): PeakHold {
  if (levelDb >= hold.db) {
    return { db: floorDb(levelDb), heldAtMs: nowMs };
  }
  if (nowMs - hold.heldAtMs < METER_PEAK_HOLD_MS) {
    return hold;
  }
  const fallen = reducedMotion
    ? levelDb
    : hold.db - (METER_PEAK_FALL_DB_PER_S * elapsedMs) / 1000;
  return { db: floorDb(Math.max(levelDb, fallen)), heldAtMs: hold.heldAtMs };
}

// The RMS level of the last METER_RMS_WINDOW_MS of audio: the power
// average of both channels, from every sample pushed into it.
export class RmsWindow {
  // Each sample frame's mean square across the channels, in a ring.
  private squares = new Float64Array(0);
  private next = 0;
  private filled = 0;
  private sum = 0;
  // Non-zero squares in the window, so silence reads exactly -Infinity
  // whatever rounding the running sum has gathered.
  private nonZero = 0;

  // Adds the frames in `channels`, one sample per channel per frame.
  push(sampleRate: number, channels: readonly ArrayLike<number>[]) {
    const size = Math.max(
      1,
      Math.round((sampleRate * METER_RMS_WINDOW_MS) / 1000),
    );
    if (size !== this.squares.length) {
      this.squares = new Float64Array(size);
      this.clear();
    }
    const frames = Math.min(...channels.map((channel) => channel.length));
    for (let frame = 0; frame < frames; frame++) {
      let square = 0;
      for (const channel of channels) {
        square += channel[frame] * channel[frame];
      }
      this.add(square / channels.length);
    }
  }

  db() {
    if (!this.nonZero) {
      return -Infinity;
    }
    return amplitudeToDb(Math.sqrt(Math.max(0, this.sum) / this.filled));
  }

  clear() {
    this.squares.fill(0);
    this.next = 0;
    this.filled = 0;
    this.sum = 0;
    this.nonZero = 0;
  }

  private add(square: number) {
    const old = this.squares[this.next];
    this.squares[this.next] = square;
    this.sum += square - old;
    this.nonZero += (square > 0 ? 1 : 0) - (old > 0 ? 1 : 0);
    this.filled = Math.min(this.filled + 1, this.squares.length);
    this.next += 1;
    if (this.next === this.squares.length) {
      this.next = 0;
      // Re-sum once per lap so the running sum doesn't drift.
      this.sum = this.squares.reduce((total, value) => total + value, 0);
    }
  }
}

// The samples each channel received since the last frame.
export type MeterBlock = {
  sampleRate: number;
  channels: readonly [ArrayLike<number>, ArrayLike<number>];
};

// What MeterTapReader needs of an AnalyserNode.
export type MeterAnalyser = {
  readonly fftSize: number;
  readonly context: {
    readonly currentTime: number;
    readonly sampleRate: number;
  };
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
};

// Reads only the samples that arrived since the last read from a pair of
// analysers. An analyser holds its latest fftSize samples, and the audio
// clock says how many have arrived since, so each sample is taken once.
// Reads further apart than fftSize samples lose the oldest of them.
export class MeterTapReader {
  private tap: { left: MeterAnalyser; right: MeterAnalyser } | null = null;
  private buffers: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [
    new Float32Array(0),
    new Float32Array(0),
  ];
  private lastFrame: number | null = null;

  // The samples since the last read, or null without a tap. The first read
  // of a tap starts the count and has no samples yet.
  read(tap: { left: MeterAnalyser; right: MeterAnalyser } | null) {
    if (tap !== this.tap) {
      this.tap = tap;
      this.lastFrame = null;
      this.buffers = tap
        ? [
            new Float32Array(tap.left.fftSize),
            new Float32Array(tap.right.fftSize),
          ]
        : [new Float32Array(0), new Float32Array(0)];
    }
    if (!tap) {
      return null;
    }
    const { currentTime, sampleRate } = tap.left.context;
    const frame = Math.round(currentTime * sampleRate);
    const arrived =
      this.lastFrame === null ? 0 : Math.max(0, frame - this.lastFrame);
    this.lastFrame = frame;
    tap.left.getFloatTimeDomainData(this.buffers[0]);
    tap.right.getFloatTimeDomainData(this.buffers[1]);
    const channels = this.buffers.map((buffer) =>
      buffer.subarray(buffer.length - Math.min(arrived, buffer.length)),
    ) as [Float32Array, Float32Array];
    return { sampleRate, channels } satisfies MeterBlock;
  }
}

export type ChannelReading = {
  // The bar's fill, with release ballistics.
  levelDb: number;
  // The high-water line.
  peakDb: number;
  // Latched once the channel goes above 0 dB, until cleared.
  clipped: boolean;
};

export type StereoReading = {
  left: ChannelReading;
  right: ChannelReading;
  // Both channels' RMS level over the last METER_RMS_WINDOW_MS of audio.
  averageDb: number;
};

type ChannelState = { levelDb: number; hold: PeakHold; clipped: boolean };

const emptyChannel = (): ChannelState => ({
  levelDb: -Infinity,
  hold: EMPTY_PEAK_HOLD,
  clipped: false,
});

// Follows the left and right channels from frame to frame.
export class StereoMeter {
  private channels = [emptyChannel(), emptyChannel()];
  private rms = new RmsWindow();
  private lastMs: number | null = null;

  // `block` holds the samples since the last update, or is null when there
  // is nothing to measure. The bars follow the loudest of those samples.
  update(
    nowMs: number,
    block: MeterBlock | null,
    reducedMotion = false,
  ): StereoReading {
    const elapsedMs = this.lastMs === null ? 0 : nowMs - this.lastMs;
    this.lastMs = nowMs;
    this.channels = this.channels.map((channel, index) => {
      const peakDb = amplitudeToDb(
        block ? samplePeak(block.channels[index]) : 0,
      );
      const levelDb = releaseLevel(
        channel.levelDb,
        peakDb,
        elapsedMs,
        reducedMotion,
      );
      return {
        levelDb,
        hold: holdPeak(channel.hold, levelDb, nowMs, elapsedMs, reducedMotion),
        clipped: channel.clipped || peakDb > 0,
      };
    });
    if (block) {
      this.rms.push(block.sampleRate, block.channels);
    } else {
      this.rms.clear();
    }
    return this.reading();
  }

  reading(): StereoReading {
    const [left, right] = this.channels.map((channel) => ({
      levelDb: channel.levelDb,
      peakDb: channel.hold.db,
      clipped: channel.clipped,
    }));
    return { left, right, averageDb: this.rms.db() };
  }

  // Nothing left to draw: the bars, peak lines and readout are all empty.
  isIdle() {
    return (
      this.rms.db() === -Infinity &&
      this.channels.every(
        (channel) =>
          channel.levelDb === -Infinity && channel.hold.db === -Infinity,
      )
    );
  }

  clearClips() {
    for (const channel of this.channels) {
      channel.clipped = false;
    }
  }

  // Restarting playback starts the frame timing afresh.
  restart() {
    this.clearClips();
    this.lastMs = null;
  }
}
