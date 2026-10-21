import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRONE_AREA_SECONDS,
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
  it("starts at the first audible sample heard and reaches the region's length", () => {
    const samples = new Float32Array(2000);
    samples.fill(0.5, 1100);
    assert.deepEqual(droneRegion(samples, RATE, 1000), {
      start: 1100,
      end: 1100 + DRONE_REGION_SECONDS * RATE,
    });
  });

  it("leaves out what was heard before the playhead reached its area", () => {
    const samples = new Float32Array(2000);
    samples.fill(0.5);
    assert.deepEqual(droneRegion(samples, RATE, 300), {
      start: 1700,
      end: 1700 + DRONE_REGION_SECONDS * RATE,
    });
  });

  it("ends at the latest audible sample while less than a region is heard", () => {
    const samples = new Float32Array(2000);
    samples.fill(0.5, 1800, 1900);
    assert.deepEqual(droneRegion(samples, RATE, 500), {
      start: 1800,
      end: 1900,
    });
  });

  it("is null for silence, or too little audio for a whole grain", () => {
    assert.equal(droneRegion(new Float32Array(2000), RATE, 1000), null);
    const short = new Float32Array(2000);
    short.fill(0.5, 2000 - DRONE_GRAIN_SECONDS * RATE + 1);
    assert.equal(droneRegion(short, RATE, 1000), null);
    const full = new Float32Array(2000);
    full.fill(0.5);
    assert.equal(droneRegion(full, RATE, DRONE_GRAIN_SECONDS * RATE - 1), null);
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
  const grains: { offset: number; at: number; duration: number }[] = [];
  const gains: ReturnType<typeof param>[] = [];
  // The length of each source the drone makes.
  const buffers: number[] = [];
  const node = () => ({
    connect: (target: unknown) => target,
    disconnect() {},
  });
  const context = {
    sampleRate: RATE,
    currentTime: 0,
    state: "running",
    // How many of the newest samples of the analyser's capture are audible.
    audible: audio,
    createAnalyser: () => ({
      ...node(),
      fftSize: 0,
      getFloatTimeDomainData(samples: Float32Array) {
        samples.fill(0);
        samples.fill(0.5, Math.max(0, samples.length - context.audible));
      },
    }),
    createGain: () => {
      const gain = param();
      gains.push(gain);
      return { ...node(), gain };
    },
    createBuffer: (_channels: number, length: number) => {
      buffers.push(length);
      return { length, copyToChannel() {} };
    },
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      onended: null,
      start(at: number, offset: number, duration: number) {
        grains.push({ at, offset, duration });
      },
    }),
  };
  return { context, grains, gains, buffers };
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

// A drone whose analyser hears the scrub's media throughout, by default.
function drone(audio = Number.POSITIVE_INFINITY) {
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
  // Moves the audio clock on by `seconds` a timer tick at a time, the
  // playhead at `playheadSeconds` and the scrub's media `capturing` or not.
  const scrub = (
    seconds: number,
    playheadSeconds: number,
    capturing = true,
  ) => {
    const until = fake.context.currentTime + seconds - 1e-9;
    while (fake.context.currentTime < until) {
      fake.context.currentTime += 0.025;
      instance.sync({ active: true, capturing, playheadSeconds });
      timers.tick?.();
    }
  };
  return { ...fake, timers, instance, level, scrub };
}

const REGION = DRONE_REGION_SECONDS * RATE;

describe("ScrubDrone", () => {
  it("drones of the scrubbed audio and keeps cycling it while held still", () => {
    const { context, grains, timers, instance, level, scrub } = drone();
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    assert.deepEqual(level.ramps, [1]);
    scrub(0.3, 1);
    const first = grains.length;
    assert.ok(first > 0);

    // The scrub's media pauses, but the grains keep reading what it played.
    context.audible = 0;
    scrub(1, 1, false);
    assert.ok(grains.length - first >= DRONE_DENSITY * 0.9);
    // Each reads from inside the captured region.
    const latest = DRONE_REGION_SECONDS - DRONE_GRAIN_SECONDS;
    for (const grain of grains) {
      assert.ok(grain.offset >= 0 && grain.offset <= latest);
    }
    assert.equal(timers.cleared, false);
  });

  it("keeps to the area the playhead reached while it holds or moves slowly", () => {
    const { buffers, instance, scrub } = drone();
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    // Nothing is heard there the moment the playhead arrives.
    assert.deepEqual(buffers, []);
    scrub(0.5, 1);
    // The source grew from where the playhead arrived to a whole region,
    // then stayed put, rather than following the newest audio.
    assert.equal(buffers.at(-1), REGION);
    const made = buffers.length;
    for (let step = 1; step <= 10; step++) {
      scrub(0.05, 1 + (step * DRONE_AREA_SECONDS) / 10);
    }
    assert.equal(buffers.length, made);
  });

  it("takes up a new area once the playhead moves off its own", () => {
    const { buffers, instance, scrub } = drone();
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    scrub(0.5, 1);
    const made = buffers.length;
    // The old area plays on until a grain of the new one is heard.
    scrub(0.05, 3);
    assert.equal(buffers.length, made);
    scrub(0.1, 3);
    assert.ok(buffers.length > made);
    // Its source is only what was heard since the playhead moved there.
    assert.ok(buffers.slice(made).every((length) => length <= 0.15 * RATE + 1));
  });

  it("ends an area's source where the scrub pauses", () => {
    const { context, buffers, instance, scrub } = drone();
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    scrub(0.1, 1);
    const made = buffers.length;
    assert.ok(made > 0 && (buffers.at(-1) ?? 0) < REGION);
    context.audible = 0;
    scrub(0.2, 1, false);
    // Scrubbing on within the area leaves its source as it was.
    context.audible = Number.POSITIVE_INFINITY;
    scrub(0.3, 1.05);
    assert.equal(buffers.length, made);
  });

  it("plays 50ms grains", () => {
    const { grains, instance, scrub } = drone();
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    scrub(0.1, 1);
    assert.ok(grains.length > 0);
    for (const grain of grains) {
      assert.equal(grain.duration, 0.05);
    }
  });

  it("stays silent until the scrub plays something", () => {
    const { grains, instance, scrub } = drone(0);
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    scrub(0.5, 1);
    assert.equal(grains.length, 0);
  });

  it("fades out on release and then stops scheduling", () => {
    const { context, grains, timers, instance, level, scrub } = drone();
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    scrub(0.2, 1);
    instance.sync({ active: false, capturing: false, playheadSeconds: 1 });
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
    instance.sync({ active: true, capturing: true, playheadSeconds: 1 });
    context.state = "closed";
    timers.tick?.();
    assert.equal(timers.cleared, true);
  });
});
