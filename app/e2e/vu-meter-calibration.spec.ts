import { expect, type Page, test } from "@playwright/test";

// Calibrates the VU meter's measurement against reference tones played
// through a real AudioContext: the app's meter tap, read by the meter's
// tap reader and StereoMeter on timer-driven frames at several rates.

type Tone = { kind: "sine" | "square" | "silence" | "pulse"; db: number };
type Reading = {
  fps: number;
  levelDb: [number, number];
  peakDb: [number, number];
  clipped: [boolean, boolean];
  averageDb: number;
  text: string;
};

async function meterTone(
  page: Page,
  tone: Tone,
  fpsList: number[] = [60],
): Promise<Reading[]> {
  return page.evaluate(
    async ({ tone, fpsList }) => {
      const { formatMeterDb, MeterTapReader, StereoMeter } = await import(
        // @ts-expect-error Vite serves the app's modules by path.
        "/src/app/vu-meter.ts"
      );
      const { createMeterTap } = await import(
        // @ts-expect-error Vite serves the app's modules by path.
        "/src/fx-shaders/audio-bands.ts"
      );
      const context = new AudioContext();
      await context.resume();
      const rate = context.sampleRate;
      // One second loops seamlessly: a whole number of 1 kHz cycles, and of
      // 100 ms pulses.
      const buffer = context.createBuffer(1, rate, rate);
      const samples = buffer.getChannelData(0);
      const amplitude = 10 ** (tone.db / 20);
      for (let index = 0; index < rate; index++) {
        const phase = (1000 * index) / rate;
        if (tone.kind === "sine") {
          samples[index] = amplitude * Math.sin(2 * Math.PI * phase);
        } else if (tone.kind === "square") {
          samples[index] = Math.floor(2 * phase) % 2 ? -amplitude : amplitude;
        } else if (tone.kind === "pulse") {
          // A -3 dB burst in every 100 ms, over a -24 dB bed.
          const level = index % (rate / 10) < rate / 40 ? -3 : -24;
          samples[index] = 10 ** (level / 20) * Math.sin(2 * Math.PI * phase);
        }
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const { input, tap } = createMeterTap(context);
      source.connect(input);
      source.start();

      const meters = fpsList.map((fps: number) => {
        const reader = new MeterTapReader();
        const meter = new StereoMeter();
        let reading = meter.reading();
        const timer = setInterval(() => {
          reading = meter.update(performance.now(), reader.read(tap));
        }, 1000 / fps);
        return { fps, timer, read: () => reading };
      });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const readings = meters.map(({ fps, timer, read }) => {
        clearInterval(timer);
        const { left, right, averageDb } = read();
        return {
          fps,
          levelDb: [left.levelDb, right.levelDb],
          peakDb: [left.peakDb, right.peakDb],
          clipped: [left.clipped, right.clipped],
          averageDb,
          text: formatMeterDb(averageDb),
        };
      });
      source.stop();
      await context.close();
      return readings as Reading[];
    },
    { tone, fpsList },
  );
}

function expectNear(actual: number, expected: number, tolerance = 0.2) {
  expect(
    Math.abs(actual - expected),
    `${actual} vs ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // A click lets the AudioContext start.
  await page.mouse.click(1, 1);
});

test("a -6 dBFS sine reads -6.0 dB on the bars and -9.0 dB RMS", async ({
  page,
}) => {
  const [reading] = await meterTone(page, { kind: "sine", db: -6 });
  for (const channel of [0, 1]) {
    expectNear(reading.levelDb[channel], -6);
    expectNear(reading.peakDb[channel], -6);
  }
  expectNear(reading.averageDb, -9.01);
  expect(reading.text).toBe("−9.0 dB");
});

test("a full-scale sine reads 0 dB without clipping; +1 dB clips", async ({
  page,
}) => {
  const [full] = await meterTone(page, { kind: "sine", db: 0 });
  expectNear(full.levelDb[0], 0);
  expectNear(full.averageDb, -3.01);
  expect(full.clipped).toEqual([false, false]);

  const [over] = await meterTone(page, { kind: "sine", db: 1 });
  expectNear(over.levelDb[0], 1);
  expect(over.clipped).toEqual([true, true]);
});

test("a -12 dBFS square wave reads -12.0 dB peak and RMS", async ({ page }) => {
  const [reading] = await meterTone(page, { kind: "square", db: -12 });
  expectNear(reading.levelDb[0], -12);
  expectNear(reading.averageDb, -12);
});

test("silence reads empty bars and -inf dB", async ({ page }) => {
  const [reading] = await meterTone(page, { kind: "silence", db: 0 });
  expect(reading.levelDb).toEqual([-Infinity, -Infinity]);
  expect(reading.text).toBe("-inf dB");
});

test("the readout is the same at 30 and 120 frames per second", async ({
  page,
}) => {
  for (const kind of ["sine", "pulse"] as const) {
    const [slow, fast] = await meterTone(page, { kind, db: -6 }, [30, 120]);
    expect(slow.averageDb).toBeGreaterThan(-30);
    expectNear(slow.averageDb, fast.averageDb, 0.1);
  }
});
