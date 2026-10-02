import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Transient Shaper is added from a clip's add menu, after the clip's Gain;
// a video clip's menu lists it in the Audio group. Its Attack and Sustain knobs start at 0 % and
// Output at 0 dB, and it has no Animation modifier. Attack moves what the
// preview hears, and the preview's chain worklet renders it as export does.
const AUDIO = new URL("./fixtures/tone.wav", import.meta.url);
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';

async function dropSourceMedia(
  page: Page,
  base64: string,
  name: string,
  type = "audio/wav",
) {
  const dataTransfer = await page.evaluateHandle(
    ({ data, name, type }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      return transfer;
    },
    { data: base64, name, type },
  );
  const target = '[data-source-track-drop-target="new-track"]';
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, eventType, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// Adds Transient Shaper to the audio clip from its add menu.
async function addTransientShaper(page: Page) {
  await page.locator(".source-span").click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: /^Transient Shaper/ })
    .click();
  const devices = page.locator(clipDevices);
  await expect(devices).toHaveCount(2);
  await expect(devices.nth(0)).toHaveAttribute("aria-label", "Gain");
  const shaper = devices.nth(1);
  await expect(shaper).toHaveAttribute("aria-label", "Transient Shaper");
  return shaper;
}

// A 16-bit stereo WAV of drum-like hits: a 400 Hz tone that starts at once
// and decays over 30 ms, ten times a second, the same on both sides.
function hitsWav(seconds: number) {
  const sampleRate = 8000;
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 4, 40);
  for (let index = 0; index < frames; index++) {
    const age = (index % (sampleRate / 10)) / sampleRate;
    const sample =
      Math.sin((2 * Math.PI * 400 * index) / sampleRate) *
      Math.exp(-age / 0.03);
    const value = Math.round(sample * 10_000);
    wav.writeInt16LE(value, 44 + index * 4);
    wav.writeInt16LE(value, 46 + index * 4);
  }
  return wav.toString("base64");
}

// Records the analysers the preview's mixer makes, which measure the mix
// after every effect.
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

// The mean level over several reads while playing, once the chain's ramps
// have settled, so where a read falls among the hits barely matters.
async function playingLevel(page: Page) {
  const play = page.getByRole("button", { name: "Play timeline" });
  if (await play.isVisible()) {
    await play.click();
  }
  await page.waitForTimeout(400);
  let total = 0;
  const reads = 8;
  for (let read = 0; read < reads; read += 1) {
    total += await mixLevel(page);
    await page.waitForTimeout(60);
  }
  return total / reads;
}

test("Transient Shaper adds to an audio clip with its defaults", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await dropSourceMedia(
    page,
    (await readFile(AUDIO)).toString("base64"),
    "tone.wav",
  );
  const shaper = await addTransientShaper(page);

  await expect(shaper.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    shaper.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  const attack = shaper.getByRole("slider", { name: "Attack" });
  const sustain = shaper.getByRole("slider", { name: "Sustain" });
  const output = shaper.getByRole("slider", { name: "Output" });
  await expect(attack).toHaveAttribute("aria-valuetext", "0%");
  await expect(sustain).toHaveAttribute("aria-valuetext", "0%");
  await expect(output).toHaveAttribute("aria-valuetext", "0.0 dB");

  await attack.press("ArrowUp");
  await expect(attack).toHaveAttribute("aria-valuetext", "+1%");
  await sustain.press("ArrowDown");
  await expect(sustain).toHaveAttribute("aria-valuetext", "−1%");

  // Removing it leaves the Gain.
  await shaper.getByRole("button", { name: "Remove Transient Shaper" }).click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await expect(page.locator(clipDevices)).toHaveAttribute("aria-label", "Gain");
});

test("a video clip's add menu lists Transient Shaper in its Audio group", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await dropSourceMedia(
    page,
    (await readFile(VIDEO)).toString("base64"),
    "test-pattern.mp4",
    "video/mp4",
  );

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("group", { name: "Video" }).getByRole("menuitem", {
      name: /^Transient Shaper/,
    }),
  ).toHaveCount(0);
  await menu
    .getByRole("group", { name: "Audio" })
    .getByRole("menuitem", { name: /^Transient Shaper/ })
    .click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await expect(page.locator(clipDevices)).toHaveAttribute(
    "aria-label",
    "Transient Shaper",
  );
});

test("Transient Shaper's Attack moves the preview's level", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await dropSourceMedia(page, hitsWav(30), "hits.wav");
  const shaper = await addTransientShaper(page);
  const attack = shaper.getByRole("slider", { name: "Attack" });

  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(0.02);
  const flat = await playingLevel(page);

  // Offline, +100 % Attack raises these hits by about 8 dB and −100 %
  // lowers them by about 5 dB.
  await attack.press("End");
  await expect(attack).toHaveAttribute("aria-valuetext", "+100%");
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(flat * 1.6);

  await attack.press("Home");
  await expect(attack).toHaveAttribute("aria-valuetext", "−100%");
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeLessThan(flat * 0.75);
});

test("the preview's chain worklet plays Transient Shaper as export renders it", async ({
  page,
}) => {
  await page.goto("/export-smoke.html");
  const result = await page.evaluate(async () => {
    // Variables keep TypeScript from resolving the dev server's paths.
    const paths = {
      url: "/src/audio-mix/chain-worklet-url.ts",
      node: "/src/audio-mix/chain-node.ts",
      mix: "/src/audio-mix/mix.ts",
      gain: "/src/fx/effects/gain/processor.ts",
    };
    const { CHAIN_WORKLET_URL } = await import(/* @vite-ignore */ paths.url);
    const { createChainNode } = await import(/* @vite-ignore */ paths.node);
    const { renderAudioMix } = await import(/* @vite-ignore */ paths.mix);
    const { gainStageAt } = await import(/* @vite-ignore */ paths.gain);

    const shaper = (id: string, attack: number, sustain: number) => ({
      id,
      effectName: "Transient Shaper",
      enabled: true,
      numbers: { Attack: attack, Sustain: sustain, Output: -3 },
      switches: {},
    });

    const sampleRate = 48_000;
    const length = sampleRate;
    const mediaSeconds = 2;
    // Hits five times a second: a 300 Hz tone decaying over 40 ms.
    const hits = new Float32Array(mediaSeconds * sampleRate);
    for (let index = 0; index < hits.length; index++) {
      const age = (index % (sampleRate / 5)) / sampleRate;
      hits[index] =
        0.3 *
        Math.sin((2 * Math.PI * 300 * index) / sampleRate) *
        Math.exp(-age / 0.04);
    }
    const clipStart = 0.1;
    const clip = {
      id: "hits",
      mediaId: "hits",
      startSeconds: clipStart,
      durationSeconds: 0.8,
      sourceOffsetSeconds: -clipStart,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: mediaSeconds,
      effects: [],
      amplitude: 1,
      hasGain: true,
      busId: "bus",
      stages: [gainStageAt(1, "clip-gain"), shaper("clip-shaper", 1, -0.5)],
    };
    const mix = {
      clips: [clip],
      buses: [{ id: "bus", stages: [shaper("bus-shaper", -0.4, 0.7)] }],
      master: [],
      masterAmplitude: 1,
      fromSourceTracks: true,
      bpm: 120,
      signature: { numerator: 4, denominator: 4 },
    };
    // Export's host: the offline render.
    const [offline] = renderAudioMix(
      mix,
      new Map([["hits", { sampleRate, channels: [hits] }]]),
      { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
    );

    // The preview's host: the chain worklet in an offline context.
    const context = new OfflineAudioContext(2, length, sampleRate);
    await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
    const tempo = { bpm: 120, signature: mix.signature };
    const transport = { contextTime: 0, timelineSeconds: 0, rate: 1 };
    const node = (stages: unknown[]) =>
      createChainNode(context, {
        settings: { stages, inputGain: 1, delayFrames: 0 },
        tempo,
        transport,
      });
    const clipChain = node(clip.stages);
    const bus = node(mix.buses[0].stages);
    const master = node(mix.master);
    const media = context.createBuffer(1, hits.length, sampleRate);
    media.copyToChannel(hits, 0);
    const source = context.createBufferSource();
    source.buffer = media;
    source.connect(clipChain);
    clipChain.connect(bus);
    bus.connect(master);
    master.connect(context.destination);
    source.start(clipStart, 0, clip.durationSeconds);
    const rendered = (await context.startRendering()).getChannelData(0);

    let difference = 0;
    let shaped = 0;
    for (let index = 0; index < length; index++) {
      difference = Math.max(
        difference,
        Math.abs(rendered[index] - offline[index]),
      );
      // How far the render is from the clip's plain hits, so a shaper that
      // did nothing in both hosts can't pass.
      const seconds = index / sampleRate;
      const dry =
        seconds >= clipStart && seconds < clipStart + clip.durationSeconds
          ? hits[index - Math.round(clipStart * sampleRate)]
          : 0;
      shaped = Math.max(shaped, Math.abs(offline[index] - dry));
    }
    return { difference, shaped };
  });
  expect(result.shaped).toBeGreaterThan(0.05);
  expect(result.difference).toBeLessThan(1e-5);
});
