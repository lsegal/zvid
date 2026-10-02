import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Tremolo is added from an audio clip's add menu, shows its defaults, and
// changes what the preview hears; the preview's worklet and the export's
// offline render run it identically.

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';

// Records the analysers the preview's mixer makes, which measure the mix.
async function probeAnalysers(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    probe.analysers = [];
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function (this: AudioContext) {
      const analyser = createAnalyser.call(this);
      probe.analysers.push(analyser);
      return analyser;
    };
  });
}

// The mix's RMS level over the analyser's latest window.
function mixLevel(page: Page) {
  return page.evaluate(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    const analyser = probe.analysers.at(-1);
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
  });
}

// The mix's level averaged over several LFO cycles once playback is under
// way: a tremolo lowers the average, though its peaks stay at full level.
async function averageLevel(page: Page) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect
    .poll(() => mixLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(0.005);
  // Read in the page, every 20 ms for a second, so a slow test runner
  // still samples five 5 Hz cycles evenly.
  const level = await page.evaluate(async () => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    const analyser = probe.analysers.at(-1);
    if (!analyser) {
      return 0;
    }
    const samples = new Float32Array(analyser.fftSize);
    const reads: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 1000) {
      analyser.getFloatTimeDomainData(samples);
      let total = 0;
      for (const sample of samples) {
        total += sample * sample;
      }
      reads.push(Math.sqrt(total / samples.length));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return reads.reduce((total, read) => total + read, 0) / reads.length;
  });
  await page
    .getByRole("button", { name: "Pause playback" })
    .click({ timeout: 2_000 })
    .catch(() => {});
  await expect(
    page.getByRole("button", { name: "Play timeline" }),
  ).toBeVisible();
  return level;
}

// A 440 Hz tone as a 16-bit mono WAV.
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
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
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

test("Tremolo is added to an audio clip with its defaults and changes the mix", async ({
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
    .getByRole("menuitem", { name: "Volume & Stereo" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Tremolo/ }).click();
  await expect(page.locator(clipDevices)).toHaveCount(2);

  const tremolo = page.locator(clipDevices).nth(1);
  await expect(tremolo).toHaveAttribute("aria-label", "Tremolo");
  await expect(
    tremolo.getByRole("img", { name: "Audio effect" }),
  ).toBeVisible();
  await expect(
    tremolo.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);

  // Synced by default: Note shows and Rate hides.
  const sync = tremolo.getByRole("group", { name: "Sync" });
  await expect(sync.getByRole("button", { name: "On" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tremolo.getByRole("combobox", { name: "Note" })).toHaveText(
    "1/8",
  );
  await expect(tremolo.getByRole("slider", { name: "Rate" })).toHaveCount(0);
  await expect(tremolo.getByRole("slider", { name: "Depth" })).toHaveAttribute(
    "aria-valuetext",
    "50%",
  );
  await expect(
    tremolo
      .getByRole("group", { name: "Shape" })
      .getByRole("button", { name: "Sine" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Free-running shows Rate at 5 Hz in place of Note.
  await sync.getByRole("button", { name: "Off" }).click();
  await expect(tremolo.getByRole("slider", { name: "Rate" })).toHaveAttribute(
    "aria-valuetext",
    "5.0 Hz",
  );
  await expect(tremolo.getByRole("combobox", { name: "Note" })).toHaveCount(0);

  await tremolo.getByRole("button", { name: "Bypass Tremolo" }).click();
  const dry = await averageLevel(page);
  expect(dry).toBeGreaterThan(0.1);

  // At full depth the level averages about half the dry level.
  await tremolo.getByRole("button", { name: "Enable Tremolo" }).click();
  await typeValue(page, "Tremolo", "Depth", "100");
  await expect(tremolo.getByRole("slider", { name: "Depth" })).toHaveAttribute(
    "aria-valuetext",
    "100%",
  );
  await expect
    .poll(() => averageLevel(page), { timeout: 30_000 })
    .toBeLessThan(dry * 0.75);

  // And back to the dry level at Depth 0 %.
  await typeValue(page, "Tremolo", "Depth", "0");
  await expect
    .poll(() => averageLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(dry * 0.9);
});

test("a video clip's add menu lists Tremolo in its Audio group", async ({
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
    .getByRole("menuitem", { name: "Volume & Stereo" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Tremolo/ }).click();
  await expect(
    page.locator(clipDevices).filter({ hasText: "Tremolo" }),
  ).toHaveCount(1);
});

test("the preview's worklet and the export's offline render play Tremolo identically", async ({
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
    // Rendering from timeline second 3.3 checks both hosts take the LFO
    // phase from the timeline.
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
        { id: "tremolo", trackId: "track", effectName: "Tremolo", parameters },
        "tremolo",
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
        { key: "Note", value: "1/16T" },
        { key: "Shape", value: "Square" },
        { key: "Depth", value: "1", numericValue: 1 },
      ]),
      await compare([
        { key: "Sync", value: "Off" },
        { key: "Rate", value: "7", numericValue: 7 },
        { key: "Shape", value: "Triangle" },
        { key: "Depth", value: "0.8", numericValue: 0.8 },
      ]),
    ];
  });
  // The tremolo did change the signal, and both hosts agree.
  for (const difference of differences) {
    expect(difference.wet).toBeGreaterThan(0.05);
    expect(difference.max).toBeLessThan(1e-5);
  }
});
