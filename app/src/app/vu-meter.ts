// Levels for the transport bar's stereo VU meter, read from the program mix
// once per animation frame. Everything here is in dBFS: 0 dB is a full-scale
// sample, and silence is -Infinity.

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
// The readout averages this much of the recent signal.
export const METER_RMS_WINDOW_MS = 300;

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

// The readout's text, with a typographic minus, or "−∞" for silence.
export function formatMeterDb(db: number) {
  if (!Number.isFinite(db)) {
    return "−∞";
  }
  const text = db.toFixed(1);
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

// The largest absolute sample, and the mean of the squared samples.
export function measureSamples(samples: ArrayLike<number>) {
  let peak = 0;
  let sumOfSquares = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    peak = Math.max(peak, Math.abs(sample));
    sumOfSquares += sample * sample;
  }
  return {
    peak,
    meanSquare: samples.length ? sumOfSquares / samples.length : 0,
  };
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

// The RMS level over the last METER_RMS_WINDOW_MS, from one mean square per
// frame.
export class RmsWindow {
  private frames: Array<{ atMs: number; meanSquare: number }> = [];

  push(nowMs: number, meanSquare: number) {
    this.frames.push({ atMs: nowMs, meanSquare });
    this.prune(nowMs);
  }

  db(nowMs: number) {
    this.prune(nowMs);
    if (!this.frames.length) {
      return -Infinity;
    }
    let sum = 0;
    for (const frame of this.frames) {
      sum += frame.meanSquare;
    }
    return amplitudeToDb(Math.sqrt(sum / this.frames.length));
  }

  clear() {
    this.frames = [];
  }

  private prune(nowMs: number) {
    const oldest = nowMs - METER_RMS_WINDOW_MS;
    while (this.frames.length && this.frames[0].atMs <= oldest) {
      this.frames.shift();
    }
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
  // Both channels' RMS level over the recent window.
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

  // `samples` holds each channel's latest time-domain samples, or is null
  // when there is nothing to measure.
  update(
    nowMs: number,
    samples: readonly [ArrayLike<number>, ArrayLike<number>] | null,
    reducedMotion = false,
  ): StereoReading {
    const elapsedMs = this.lastMs === null ? 0 : nowMs - this.lastMs;
    this.lastMs = nowMs;
    let meanSquare = 0;
    this.channels = this.channels.map((channel, index) => {
      const measured = samples
        ? measureSamples(samples[index])
        : { peak: 0, meanSquare: 0 };
      meanSquare += measured.meanSquare / 2;
      const peakDb = amplitudeToDb(measured.peak);
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
    if (samples) {
      this.rms.push(nowMs, meanSquare);
    }
    return this.reading(nowMs);
  }

  reading(nowMs: number): StereoReading {
    const [left, right] = this.channels.map((channel) => ({
      levelDb: channel.levelDb,
      peakDb: channel.hold.db,
      clipped: channel.clipped,
    }));
    return { left, right, averageDb: this.rms.db(nowMs) };
  }

  // Nothing left to draw: the bars, peak lines and readout are all empty.
  isIdle(nowMs: number) {
    return (
      this.rms.db(nowMs) === -Infinity &&
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
