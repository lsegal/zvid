import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRONE_DENSITY,
  DRONE_GRAIN_SECONDS,
  DRONE_REGION_SECONDS,
  droneRegion,
  grainEnvelope,
  grainOffset,
  ScrubDrone,
  type ScrubDroneTimers,
} from "./scrub-drone.ts";

const RATE = 1000;

describe("droneRegion", () => {
  it("ends at the latest audible sample and reaches back the region's length", () => {
    const samples = new Float32Array(2000);
    samples.fill(0.5, 0, 1500);
    assert.deepEqual(droneRegion(samples, RATE), {
      start: 1500 - DRONE_REGION_SECONDS * RATE,
      end: 1500,
    });
  });

  it("is null for silence, or too little audio for a whole grain", () => {
    assert.equal(droneRegion(new Float32Array(2000), RATE), null);
    const short = new Float32Array(2000);
    short.fill(0.5, 0, DRONE_GRAIN_SECONDS * RATE - 1);
    assert.equal(droneRegion(short, RATE), null);
  });
});

describe("grainOffset", () => {
  it("keeps the whole grain inside the region", () => {
    const region = { start: 100, end: 350 };
    assert.equal(grainOffset(region, RATE, 0), 0.1);
    const end = grainOffset(region, RATE, 1) + DRONE_GRAIN_SECONDS;
    assert.ok(Math.abs(end - region.end / RATE) < 1e-9);
  });
});

describe("grainEnvelope", () => {
  it("is a Hann window, silent at both ends", () => {
    const curve = grainEnvelope();
    assert.equal(curve[0], 0);
    assert.ok(Math.abs(curve[curve.length - 1]) < 1e-9);
    assert.ok(curve[curve.length / 2] > 0);
  });
});

// An AudioParam that records its last ramp.
function param(value = 1) {
  return {
    value,
    ramps: [] as number[],
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime(target: number) {
      this.ramps.push(target);
    },
    setValueCurveAtTime() {},
  };
}

function fakeContext(audio: number) {
  const grains: { offset: number; at: number }[] = [];
  const gains: ReturnType<typeof param>[] = [];
  const node = () => ({
    connect: (target: unknown) => target,
    disconnect() {},
  });
  const context = {
    sampleRate: RATE,
    currentTime: 0,
    state: "running",
    // How many samples of the analyser's capture are audible.
    audible: audio,
    createAnalyser: () => ({
      ...node(),
      fftSize: 0,
      getFloatTimeDomainData(samples: Float32Array) {
        samples.fill(0);
        samples.fill(0.5, 0, context.audible);
      },
    }),
    createGain: () => {
      const gain = param();
      gains.push(gain);
      return { ...node(), gain };
    },
    createBuffer: (_channels: number, length: number) => ({
      length,
      copyToChannel() {},
    }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      onended: null,
      start(at: number, offset: number) {
        grains.push({ at, offset });
      },
    }),
  };
  return { context, grains, gains };
}

function fakeTimers() {
  const timers = {
    tick: null as (() => void) | null,
    cleared: false,
    setInterval(callback: () => void) {
      timers.tick = callback;
      timers.cleared = false;
      return 1;
    },
    clearInterval() {
      timers.cleared = true;
      timers.tick = null;
    },
  };
  return timers;
}

function drone(audio = 1000) {
  const fake = fakeContext(audio);
  const timers = fakeTimers();
  const instance = new ScrubDrone(
    fake.context as unknown as BaseAudioContext,
    { connect() {} } as unknown as AudioNode,
    {} as AudioNode,
    () => 0.5,
    timers as unknown as ScrubDroneTimers,
  );
  // The drone's own gain, made after the analyser.
  const level = fake.gains[0];
  return { ...fake, timers, instance, level };
}

describe("ScrubDrone", () => {
  it("drones of the scrubbed audio and keeps cycling it while held still", () => {
    const { context, grains, timers, instance, level } = drone();
    instance.sync({ active: true, capturing: true });
    assert.deepEqual(level.ramps, [1]);
    const first = grains.length;
    assert.ok(first > 0);

    // The scrub's media pauses, but the grains keep reading what it played.
    context.audible = 0;
    instance.sync({ active: true, capturing: false });
    for (let step = 1; step <= 40; step++) {
      context.currentTime = step * 0.025;
      timers.tick?.();
    }
    assert.ok(grains.length - first >= DRONE_DENSITY * 0.9);
    // Each reads from inside the captured region.
    const latest = DRONE_REGION_SECONDS - DRONE_GRAIN_SECONDS;
    for (const grain of grains) {
      assert.ok(grain.offset >= 0 && grain.offset <= latest);
    }
    assert.equal(timers.cleared, false);
  });

  it("stays silent until the scrub plays something", () => {
    const { grains, timers, instance } = drone(0);
    instance.sync({ active: true, capturing: true });
    timers.tick?.();
    assert.equal(grains.length, 0);
  });

  it("fades out on release and then stops scheduling", () => {
    const { context, grains, timers, instance, level } = drone();
    instance.sync({ active: true, capturing: true });
    instance.sync({ active: false, capturing: false });
    assert.deepEqual(level.ramps, [1, 0]);
    // Past the fade, no more grains start.
    const scheduled = grains.length;
    context.currentTime = 1;
    timers.tick?.();
    assert.equal(timers.cleared, true);
    assert.equal(grains.length, scheduled);
  });

  it("stops once its context closes", () => {
    const { context, timers, instance } = drone();
    instance.sync({ active: true, capturing: true });
    context.state = "closed";
    timers.tick?.();
    assert.equal(timers.cleared, true);
  });
});
