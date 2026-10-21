// The granular drone a ruler scrub sustains (see preview-graph.ts). An
// analyser taps the mix after the limiter, so it hears what the scrub plays
// at the playhead; while the scrub moves, the latest audible stretch of it
// is kept as the drone's source. Grains, short Hann-windowed reads of that
// source, are scheduled a little ahead on the audio clock for as long as the
// ruler is held, so holding the playhead still keeps cycling the spot it
// stopped on instead of going silent. The drone fades in as the scrub starts
// and out over the scrub's tail when it is released or playback takes over.
// It plays after the analyser, so it never feeds back into its own source,
// audio-reactive effects or the VU meter, and export never hears it.
import { TIMELINE_SCRUB_AUDIO_TAIL_MS } from "../app/constants.ts";

// How much recent mix the analyser keeps, the most it allows: about 0.7 s
// at 48 kHz.
const CAPTURE_FFT_SIZE = 32768;
// The stretch before the latest audible sample that grains read, so the
// drone sounds of the playhead rather than of where the scrub came from.
export const DRONE_REGION_SECONDS = 0.25;
export const DRONE_GRAIN_SECONDS = 0.05;
// Grains started a second, which overlap DRONE_GRAIN_SECONDS * this deep.
export const DRONE_DENSITY = 50;
// The drone's level under the scrub, leaving it quieter than the mix.
export const DRONE_LEVEL = 0.5;
// Quieter than this is silence, as where the scrub's media has paused.
const SILENCE = 1e-4;
// How far ahead grains are scheduled, and how often the schedule is topped
// up, so a busy main thread still leaves the drone unbroken.
const LOOKAHEAD_SECONDS = 0.12;
const TICK_MS = 25;
const FADE_SECONDS = TIMELINE_SCRUB_AUDIO_TAIL_MS / 1000;
const HANN_POINTS = 64;

export type ScrubDroneState = {
  // The ruler is held, with playback not running.
  active: boolean;
  // The scrub's media is sounding, so the source is refreshed from it.
  capturing: boolean;
};

export type DroneRegion = { start: number; end: number };

// Where in `samples` grains read: the DRONE_REGION_SECONDS before its latest
// audible sample, in samples, or null when too little of it is audible for
// a whole grain, as when it is silent throughout.
export function droneRegion(
  samples: Float32Array,
  sampleRate: number,
): DroneRegion | null {
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1]) <= SILENCE) {
    end--;
  }
  if (end < DRONE_GRAIN_SECONDS * sampleRate) {
    return null;
  }
  const length = Math.round(DRONE_REGION_SECONDS * sampleRate);
  return { start: Math.max(0, end - length), end };
}

// The offset, in seconds, a grain starting `along` (0 to 1) through the
// region reads from, so it ends inside the region where it can.
export function grainOffset(
  region: DroneRegion,
  sampleRate: number,
  along: number,
) {
  const grain = DRONE_GRAIN_SECONDS * sampleRate;
  const span = Math.max(0, region.end - region.start - grain);
  return (region.start + along * span) / sampleRate;
}

// A grain's level over its length: a Hann window, quieter the more grains
// overlap, since they add up.
let curve: Float32Array<ArrayBuffer> | null = null;

export function grainEnvelope() {
  if (!curve) {
    const level =
      DRONE_LEVEL / Math.sqrt(Math.max(1, DRONE_DENSITY * DRONE_GRAIN_SECONDS));
    curve = new Float32Array(HANN_POINTS);
    for (let step = 0; step < HANN_POINTS; step++) {
      curve[step] =
        level *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * step) / (HANN_POINTS - 1)));
    }
  }
  return curve;
}

export type ScrubDroneTimers = {
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
};

export class ScrubDrone {
  private readonly analyser: AnalyserNode;
  private readonly gain: GainNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private source: AudioBuffer | null = null;
  private region: DroneRegion | null = null;
  private state: ScrubDroneState = { active: false, capturing: false };
  private timer: number | null = null;
  // When the next grain starts, by the audio clock.
  private nextGrainAt = 0;
  // When the fade-out ends, after which the drone stops scheduling.
  private silentAt: number | null = null;

  private readonly context: BaseAudioContext;
  private readonly random: () => number;
  private readonly timers: ScrubDroneTimers;

  constructor(
    context: BaseAudioContext,
    input: AudioNode,
    output: AudioNode,
    random: () => number = Math.random,
    timers: ScrubDroneTimers = {
      setInterval: (callback, ms) =>
        Number(globalThis.setInterval(callback, ms)),
      clearInterval: (id) => globalThis.clearInterval(id),
    },
  ) {
    this.context = context;
    this.random = random;
    this.timers = timers;
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = CAPTURE_FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    input.connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(output);
  }

  sync(state: ScrubDroneState) {
    const started = state.active && !this.state.active;
    const released = !state.active && this.state.active;
    this.state = state;
    if (started) {
      // A new scrub drones only of what it plays itself.
      this.source = null;
      this.region = null;
      this.silentAt = null;
      this.nextGrainAt = this.context.currentTime;
      this.fadeTo(1);
      this.timer ??= this.timers.setInterval(() => this.tick(), TICK_MS);
      this.tick();
    } else if (released) {
      this.fadeTo(0);
      this.silentAt = this.context.currentTime + FADE_SECONDS;
    } else if (state.active && state.capturing) {
      this.capture();
    }
  }

  dispose() {
    this.stop();
    this.analyser.disconnect();
    this.gain.disconnect();
  }

  private tick() {
    const now = this.context.currentTime;
    const closed = this.context.state === "closed";
    if (closed || (this.silentAt !== null && now >= this.silentAt)) {
      this.stop();
      return;
    }
    if (this.state.active && this.state.capturing) {
      this.capture();
    }
    const until = this.silentAt ?? now + LOOKAHEAD_SECONDS;
    this.nextGrainAt = Math.max(this.nextGrainAt, now);
    while (this.nextGrainAt < until) {
      this.playGrain(this.nextGrainAt);
      this.nextGrainAt += 1 / DRONE_DENSITY;
    }
  }

  private stop() {
    if (this.timer !== null) {
      this.timers.clearInterval(this.timer);
      this.timer = null;
    }
    this.silentAt = null;
  }

  // Keeps the latest audible stretch of the mix as the source, or the one
  // before it while the mix is silent.
  private capture() {
    this.analyser.getFloatTimeDomainData(this.samples);
    const { sampleRate } = this.context;
    const region = droneRegion(this.samples, sampleRate);
    if (!region) {
      return;
    }
    // Grains already scheduled keep reading the buffer they were given.
    const source = this.context.createBuffer(
      1,
      region.end - region.start,
      sampleRate,
    );
    source.copyToChannel(this.samples.subarray(region.start, region.end), 0);
    this.source = source;
    this.region = { start: 0, end: region.end - region.start };
  }

  private playGrain(at: number) {
    if (!this.source || !this.region) {
      return;
    }
    const { context } = this;
    const grain = context.createBufferSource();
    grain.buffer = this.source;
    const envelope = context.createGain();
    envelope.gain.value = 0;
    envelope.gain.setValueCurveAtTime(grainEnvelope(), at, DRONE_GRAIN_SECONDS);
    grain.connect(envelope).connect(this.gain);
    grain.onended = () => {
      envelope.disconnect();
    };
    const offset = grainOffset(this.region, context.sampleRate, this.random());
    grain.start(at, offset, DRONE_GRAIN_SECONDS);
  }

  // Ramps the drone's level to `value` over the scrub's tail, from wherever
  // an unfinished fade has it.
  private fadeTo(value: number) {
    const param = this.gain.gain;
    if (typeof param.linearRampToValueAtTime !== "function") {
      param.value = value;
      return;
    }
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + FADE_SECONDS);
  }
}
