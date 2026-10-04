import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Delay is added from an audio clip's add menu, shows its defaults, and
// changes what the preview hears; the preview's worklet and the export's
// offline render run it identically.

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';

// The meter tap's analysers are made to keep 16384 samples, about 340 ms:
// long enough that reads 20 ms apart overlap and cover every sample between
// them, even when a busy runner delays some reads. The band analyser keeps
// only about 21 ms, so its reads land on or off a burst depending on the
// runner's timing.
const METER_FFT_SIZE = 16384;
const BAND_FFT_SIZE = 1024;

// Records the analysers the preview's mixer makes, which measure the mix,
// and widens the meter's (anything larger than the band analyser) to
// METER_FFT_SIZE. The meter sizes its reads from its analysers, so it reads
// them the same way.
async function probeAnalysers(page: Page) {
  await page.addInitScript(
    ([meterSize, bandSize]) => {
      const probe = window as unknown as { analysers: AnalyserNode[] };
      probe.analysers = [];
      const fftSize = Object.getOwnPropertyDescriptor(
        AnalyserNode.prototype,
        "fftSize",
      );
      const createAnalyser = AudioContext.prototype.createAnalyser;
      AudioContext.prototype.createAnalyser = function (this: AudioContext) {
        const analyser = createAnalyser.call(this);
        Object.defineProperty(analyser, "fftSize", {
          configurable: true,
          get() {
            return fftSize?.get?.call(this);
          },
          set(size: number) {
            fftSize?.set?.call(this, size > bandSize ? meterSize : size);
          },
        });
        probe.analysers.push(analyser);
        return analyser;
      };
    },
    [METER_FFT_SIZE, BAND_FFT_SIZE],
  );
}

// The mix's RMS level over the meter analyser's latest window.
function mixLevel(page: Page) {
  return page.evaluate((fftSize) => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    const analyser = probe.analysers.findLast(
      (candidate) => candidate.fftSize === fftSize,
    );
    if (!analyser) {
      return 0;
    }
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let total = 0;
    for (const sample of samples) {
      total += sample * sample;
    }
    return Math.sqrt(total / samples.length);
  }, METER_FFT_SIZE);
}

// The mix's RMS level over four whole burst periods once playback is
// under way: echoes fill the gaps between the bursts and raise it.
async function averageLevel(page: Page) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect
    .poll(() => mixLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(0.005);
  // Read in the page, every 20 ms for two seconds, and average the power
  // rather than each read's RMS: the overlapping windows weigh the bursts
  // and their gaps evenly, so the result doesn't depend on when the reads
  // land.
  const level = await page.evaluate(async (fftSize) => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    const analyser = probe.analysers.findLast(
      (candidate) => candidate.fftSize === fftSize,
    );
    if (!analyser) {
      return 0;
    }
    const samples = new Float32Array(analyser.fftSize);
    let power = 0;
    let reads = 0;
    const start = performance.now();
    while (performance.now() - start < 2000) {
      analyser.getFloatTimeDomainData(samples);
      let total = 0;
      for (const sample of samples) {
        total += sample * sample;
      }
      power += total / samples.length;
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return Math.sqrt(power / reads);
  }, METER_FFT_SIZE);
  // A busy runner can take longer than one click's timeout to act on
  // Pause, so keep pausing until the Play button is back.
  await expect(async () => {
    const pause = page.getByRole("button", { name: "Pause playback" });
    if (await pause.isVisible()) {
      await pause.click({ timeout: 2_000 });
    }
    await expect(
      page.getByRole("button", { name: "Play timeline" }),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return level;
}

// 440 Hz bursts, 50 ms every 500 ms, as a 16-bit mono WAV.
function toneWav(seconds: number) {
  const sampleRate = 8000;
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) {
    const sounding = index % (sampleRate / 2) < sampleRate / 20;
    const sample = sounding
      ? Math.sin((2 * Math.PI * 440 * index) / sampleRate)
      : 0;
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 2);
  }
  return wav.toString("base64");
}

async function addTone(page: Page) {
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, toneWav(30));
  const target = '[data-source-track-drop-target="new-track"]';
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, eventType, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

async function typeValue(
  page: Page,
  device: string,
  label: string,
  value: string,
) {
  const panel = page.locator(`${clipDevices}[aria-label="${device}"]`);
  // A knob's readout opens its editor on a double-click.
  await panel
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = panel.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("Delay is added to an audio clip with its defaults and changes the mix", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addTone(page);
  await page.locator(".source-span").click();
  await expect(page.locator(clipDevices)).toHaveCount(1);

  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Modulation & Delay" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Delay/ }).click();
  await expect(page.locator(clipDevices)).toHaveCount(2);

  const delay = page.locator(clipDevices).nth(1);
  await expect(delay).toHaveAttribute("aria-label", "Delay");
  await expect(delay.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    delay.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);

  // Synced by default: Note shows and Time hides.
  const sync = delay.getByRole("group", { name: "Sync" });
  await expect(sync.getByRole("button", { name: "On" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(delay.getByRole("combobox", { name: "Note" })).toHaveText(
    "1/8D",
  );
  await expect(delay.getByRole("slider", { name: "Time" })).toHaveCount(0);
  await expect(delay.getByRole("slider", { name: "Feedback" })).toHaveAttribute(
    "aria-valuetext",
    "35%",
  );
  await expect(
    delay
      .getByRole("group", { name: "Ping-pong" })
      .getByRole("button", { name: "Off" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(delay.getByRole("slider", { name: "High cut" })).toHaveAttribute(
    "aria-valuetext",
    "8.00 kHz",
  );
  await expect(delay.getByRole("slider", { name: "Mix" })).toHaveAttribute(
    "aria-valuetext",
    "30%",
  );

  // Free-running shows Time at 375 ms in place of Note.
  await sync.getByRole("button", { name: "Off" }).click();
  await expect(delay.getByRole("slider", { name: "Time" })).toHaveAttribute(
    "aria-valuetext",
    "375 ms",
  );
  await expect(delay.getByRole("combobox", { name: "Note" })).toHaveCount(0);

  await delay.getByRole("button", { name: "Bypass Delay" }).click();
  const dry = await averageLevel(page);
  expect(dry).toBeGreaterThan(0.02);

  // Fully wet with 90 % feedback, the repeats fill the gaps between the
  // bursts and the average level rises well above the dry level.
  await delay.getByRole("button", { name: "Enable Delay" }).click();
  await typeValue(page, "Delay", "Time", "100");
  await typeValue(page, "Delay", "Mix", "1");
  await typeValue(page, "Delay", "Feedback", "0.9");
  await expect(delay.getByRole("slider", { name: "Feedback" })).toHaveAttribute(
    "aria-valuetext",
    "90%",
  );
  await expect
    .poll(() => averageLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(dry * 1.5);

  // With no feedback, one repeat replaces each burst: back near the dry
  // level.
  await typeValue(page, "Delay", "Feedback", "0");
  await expect
    .poll(() => averageLevel(page), { timeout: 30_000 })
    .toBeLessThan(dry * 1.2);
});

test("a video clip's add menu lists Delay in its Audio group", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, eventType, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const audio = page.getByRole("menu").getByRole("group", { name: "Audio" });
  await audio
    .getByRole("menuitem", { name: "Modulation & Delay" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Delay/ }).click();
  await expect(
    page.locator(clipDevices).filter({ hasText: "Delay" }),
  ).toHaveCount(1);
});

test("the preview's worklet and the export's offline render play Delay identically", async ({
  page,
}) => {
  await page.goto("/");
  const differences = await page.evaluate(async () => {
    // Variables keep TypeScript from resolving the dev server's paths.
    const paths = {
      chain: "/src/audio-mix/chain.ts",
      node: "/src/audio-mix/chain-node.ts",
      url: "/src/audio-mix/chain-worklet-url.ts",
      processors: "/src/audio-mix/processors.ts",
      stages: "/src/audio-mix/stages.ts",
      processor: "/src/audio-mix/processor.ts",
    };
    const { AudioChain, BLOCK_FRAMES } = await import(
      /* @vite-ignore */ paths.chain
    );
    const { createChainNode } = await import(/* @vite-ignore */ paths.node);
    const { CHAIN_WORKLET_URL } = await import(/* @vite-ignore */ paths.url);
    const { AUDIO_PROCESSORS } = await import(
      /* @vite-ignore */ paths.processors
    );
    const { audioStageOf } = await import(/* @vite-ignore */ paths.stages);
    const { DEFAULT_TIME_SIGNATURE } = await import(
      /* @vite-ignore */ paths.processor
    );

    const sampleRate = 48_000;
    const frames = sampleRate * 2;
    // Rendering from timeline second 3.3 checks both hosts agree away
    // from the timeline's start.
    const startSeconds = 3.3;
    const tempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };

    let seed = 7;
    const input = [0, 1].map(() =>
      Float32Array.from({ length: frames }, () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return (seed / 2 ** 32 - 0.5) * 0.5;
      }),
    );

    async function compare(
      parameters: { key: string; value: string; numericValue?: number }[],
    ) {
      const stage = audioStageOf(
        { id: "delay", trackId: "track", effectName: "Delay", parameters },
        "delay",
      );
      const settings = { stages: [stage], inputGain: 1, delayFrames: 0 };

      // The export's host: the chain run block by block on the main
      // thread.
      const chain = new AudioChain(AUDIO_PROCESSORS, sampleRate, 2);
      chain.configure(settings, tempo);
      const offline = input.map(() => new Float32Array(frames));
      for (let at = 0; at < frames; at += BLOCK_FRAMES) {
        const count = Math.min(BLOCK_FRAMES, frames - at);
        chain.process(
          input.map((channel) => channel.subarray(at, at + count)),
          offline.map((channel) => channel.subarray(at, at + count)),
          count,
          startSeconds + at / sampleRate,
        );
      }

      // The preview's host: the chain worklet.
      const context = new OfflineAudioContext(2, frames, sampleRate);
      await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
      const buffer = context.createBuffer(2, frames, sampleRate);
      input.forEach((channel, index) => {
        buffer.copyToChannel(channel, index);
      });
      const source = context.createBufferSource();
      source.buffer = buffer;
      const node = createChainNode(context, {
        channels: 2,
        settings,
        tempo,
        transport: { contextTime: 0, timelineSeconds: startSeconds, rate: 1 },
      });
      source.connect(node).connect(context.destination);
      source.start(0);
      const rendered = await context.startRendering();

      let max = 0;
      let wet = 0;
      for (let channel = 0; channel < 2; channel++) {
        const preview = rendered.getChannelData(channel);
        for (let index = 0; index < frames; index++) {
          max = Math.max(
            max,
            Math.abs(preview[index] - offline[channel][index]),
          );
          wet = Math.max(
            wet,
            Math.abs(offline[channel][index] - input[channel][index]),
          );
        }
      }
      return { max, wet };
    }

    return [
      await compare([
        { key: "Sync", value: "On" },
        { key: "Note", value: "1/16D" },
        { key: "Feedback", value: "0.8", numericValue: 0.8 },
        { key: "Ping-pong", value: "On" },
        { key: "High cut", value: "3000", numericValue: 3000 },
        { key: "Mix", value: "0.5", numericValue: 0.5 },
      ]),
      await compare([
        { key: "Sync", value: "Off" },
        { key: "Time", value: "123.4", numericValue: 123.4 },
        { key: "Feedback", value: "0.6", numericValue: 0.6 },
        { key: "Ping-pong", value: "Off" },
        { key: "High cut", value: "12000", numericValue: 12000 },
        { key: "Mix", value: "0.7", numericValue: 0.7 },
      ]),
    ];
  });
  // The delay did change the signal, and both hosts agree.
  for (const difference of differences) {
    expect(difference.wet).toBeGreaterThan(0.05);
    expect(difference.max).toBeLessThan(1e-5);
  }
});
