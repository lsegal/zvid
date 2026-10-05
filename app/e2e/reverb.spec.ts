import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Reverb is added from an audio clip's add menu, shows its defaults, and
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

// The level once playback is under way, as the steadiest of a few reads.
async function playingLevel(page: Page) {
  await page.getByRole("button", { name: "Jump to timeline start" }).click();
  await page.getByRole("button", { name: "Play timeline" }).click();
  let level = 0;
  await expect
    .poll(
      async () => {
        level = 0;
        for (let read = 0; read < 6; read += 1) {
          level = Math.max(level, await mixLevel(page));
          await page.waitForTimeout(50);
        }
        return level;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.005);
  await page
    .getByRole("button", { name: "Pause playback" })
    .click({ timeout: 2_000 })
    .catch(() => {});
  await expect(
    page.getByRole("button", { name: "Play timeline" }),
  ).toBeVisible();
  return level;
}

// Seeded white noise as a 16-bit mono WAV: broadband, so the reverb's level
// follows Decay rather than how one frequency meets its modes.
function noiseWav(seconds: number) {
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
  let seed = 11;
  for (let index = 0; index < frames; index++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const sample = seed / 2 ** 31 - 1;
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 2);
  }
  return wav.toString("base64");
}

async function addNoise(page: Page) {
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "noise.wav", { type: "audio/wav" }));
    return transfer;
  }, noiseWav(8));
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

test("Reverb is added to an audio clip with its defaults and changes the mix", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addNoise(page);
  await page.locator(".source-span").click();
  await expect(page.locator(clipDevices)).toHaveCount(1);

  // An audio clip's menu offers only audio effects, without headings.
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Stylize" })).toHaveCount(0);
  await menu
    .getByRole("menuitem", { name: "Modulation & Delay" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Reverb/ }).click();
  await expect(page.locator(clipDevices)).toHaveCount(2);

  const reverb = page.locator(clipDevices).nth(1);
  await expect(reverb).toHaveAttribute("aria-label", "Reverb");
  await expect(reverb.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    reverb.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  for (const [label, text] of [
    ["Decay", "2.00 s"],
    ["Pre-delay", "20 ms"],
    ["Size", "50%"],
    ["Damping", "8.00 kHz"],
    ["Mix", "25%"],
  ]) {
    await expect(reverb.getByRole("slider", { name: label })).toHaveAttribute(
      "aria-valuetext",
      text,
    );
  }

  await reverb.getByRole("button", { name: "Bypass Reverb" }).click();
  const dry = await playingLevel(page);
  expect(dry).toBeGreaterThan(0.1);

  // All wet, a short room returns about half the noise's level...
  await reverb.getByRole("button", { name: "Enable Reverb" }).click();
  await typeValue(page, "Reverb", "Mix", "100");
  await typeValue(page, "Reverb", "Decay", "0.2");
  await expect(reverb.getByRole("slider", { name: "Decay" })).toHaveAttribute(
    "aria-valuetext",
    "0.20 s",
  );
  let short = 0;
  await expect
    .poll(
      async () => {
        short = await playingLevel(page);
        return short;
      },
      { timeout: 30_000 },
    )
    .toBeLessThan(dry * 0.75);

  // ...and a longer Decay builds up more of it.
  await typeValue(page, "Reverb", "Decay", "4");
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(short * 1.3);

  // All dry again at Mix 0 %.
  await typeValue(page, "Reverb", "Mix", "0");
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(dry * 0.9);
});

test("a video clip's add menu lists Reverb in its Audio group", async ({
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
  await page.getByRole("menuitem", { name: /^Reverb/ }).click();
  await expect(
    page.locator(clipDevices).filter({ hasText: "Reverb" }),
  ).toHaveCount(1);
});

test("the preview's worklet and the export's offline render play Reverb identically", async ({
  page,
}) => {
  await page.goto("/");
  const difference = await page.evaluate(async () => {
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
    const startSeconds = 3.25;
    const tempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
    const stage = audioStageOf(
      {
        id: "reverb",
        trackId: "track",
        effectName: "Reverb",
        parameters: [
          { key: "Decay", value: "1.5", numericValue: 1.5 },
          { key: "Pre-delay", value: "30", numericValue: 30 },
          { key: "Size", value: "0.8", numericValue: 0.8 },
          { key: "Damping", value: "6000", numericValue: 6000 },
          { key: "Mix", value: "0.6", numericValue: 0.6 },
        ],
      },
      "reverb",
    );
    const settings = { stages: [stage], inputGain: 1, delayFrames: 0 };

    let seed = 7;
    const input = [0, 1].map(() =>
      Float32Array.from({ length: frames }, () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return (seed / 2 ** 32 - 0.5) * 0.5;
      }),
    );

    // The export's host: the chain run block by block on the main thread.
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
        max = Math.max(max, Math.abs(preview[index] - offline[channel][index]));
        wet = Math.max(
          wet,
          Math.abs(offline[channel][index] - input[channel][index]),
        );
      }
    }
    return { max, wet };
  });
  // The reverb did change the signal, and both hosts agree.
  expect(difference.wet).toBeGreaterThan(0.05);
  expect(difference.max).toBeLessThan(1e-5);
});
