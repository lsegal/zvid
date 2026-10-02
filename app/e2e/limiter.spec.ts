import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Limiter is added from a clip's add menu, after the clip's Gain; a video
// clip's menu lists it in the Audio group. Its knobs start at a −1 dB
// Ceiling, 50 ms Release, 5 ms Lookahead and 0 dB Gain, and it has no
// Animation modifier. Ceiling and Gain move what the preview hears, and the
// preview's chain worklet renders it as export does.
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

// Adds Limiter to the audio clip from its add menu.
async function addLimiter(page: Page) {
  await page.locator(".source-span").click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: /^Limiter/ })
    .click();
  const devices = page.locator(clipDevices);
  await expect(devices).toHaveCount(2);
  await expect(devices.nth(0)).toHaveAttribute("aria-label", "Gain");
  const limiter = devices.nth(1);
  await expect(limiter).toHaveAttribute("aria-label", "Limiter");
  return limiter;
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

test("Limiter adds to an audio clip with its defaults", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await dropSourceMedia(
    page,
    (await readFile(AUDIO)).toString("base64"),
    "tone.wav",
  );
  const limiter = await addLimiter(page);

  await expect(
    limiter.getByRole("img", { name: "Audio effect" }),
  ).toBeVisible();
  await expect(
    limiter.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  const ceiling = limiter.getByRole("slider", { name: "Ceiling" });
  const release = limiter.getByRole("slider", { name: "Release" });
  const lookahead = limiter.getByRole("slider", { name: "Lookahead" });
  const gain = limiter.getByRole("slider", { name: "Gain" });
  await expect(ceiling).toHaveAttribute("aria-valuetext", "−1.0 dB");
  await expect(release).toHaveAttribute("aria-valuetext", "50 ms");
  await expect(lookahead).toHaveAttribute("aria-valuetext", "5.0 ms");
  await expect(gain).toHaveAttribute("aria-valuetext", "0.0 dB");

  await ceiling.press("ArrowDown");
  await expect(ceiling).toHaveAttribute("aria-valuetext", "−1.1 dB");
  await lookahead.press("End");
  await expect(lookahead).toHaveAttribute("aria-valuetext", "10.0 ms");

  // Removing it leaves the Gain.
  await limiter.getByRole("button", { name: "Remove Limiter" }).click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await expect(page.locator(clipDevices)).toHaveAttribute("aria-label", "Gain");
});

test("a video clip's add menu lists Limiter in its Audio group", async ({
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
      name: /^Limiter/,
    }),
  ).toHaveCount(0);
  await menu
    .getByRole("group", { name: "Audio" })
    .getByRole("menuitem", { name: /^Limiter/ })
    .click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await expect(page.locator(clipDevices)).toHaveAttribute(
    "aria-label",
    "Limiter",
  );
});

test("Limiter's Ceiling and Gain move the preview's level", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await dropSourceMedia(page, hitsWav(30), "hits.wav");
  const limiter = await addLimiter(page);
  const ceiling = limiter.getByRole("slider", { name: "Ceiling" });
  const gain = limiter.getByRole("slider", { name: "Gain" });

  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(0.02);
  // The hits peak around −10 dBFS, under the default −1 dB Ceiling.
  const open = await playingLevel(page);

  // 24 dB of Gain drives them into the Ceiling, louder than before.
  await gain.press("End");
  await expect(gain).toHaveAttribute("aria-valuetext", "+24.0 dB");
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(open * 1.6);

  // Without the drive, a −20 dB Ceiling holds them about 10 dB down.
  await gain.press("Home");
  await expect(gain).toHaveAttribute("aria-valuetext", "0.0 dB");
  await ceiling.press("Home");
  await expect(ceiling).toHaveAttribute("aria-valuetext", "−20.0 dB");
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeLessThan(open * 0.6);
});

test("the preview's chain worklet plays Limiter as export renders it", async ({
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

    const limiter = (
      id: string,
      ceiling: number,
      lookahead: number,
      gain: number,
    ) => ({
      id,
      effectName: "Limiter",
      enabled: true,
      numbers: {
        Ceiling: ceiling,
        Release: 30,
        Lookahead: lookahead,
        Gain: gain,
      },
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
      stages: [gainStageAt(1, "clip-gain"), limiter("clip-limiter", -6, 5, 6)],
    };
    const mix = {
      clips: [clip],
      buses: [{ id: "bus", stages: [limiter("bus-limiter", -9, 2, 0)] }],
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

    // The worklet chains run uncompensated, so the preview comes out the
    // Limiters' lookaheads (5 ms and 2 ms) late; the offline render
    // compensates them, as the preview mixer does by its timing.
    const latency =
      Math.round(0.005 * sampleRate) + Math.round(0.002 * sampleRate);
    let difference = 0;
    let shaped = 0;
    let loudest = 0;
    for (let index = 0; index < length - latency; index++) {
      difference = Math.max(
        difference,
        Math.abs(rendered[index + latency] - offline[index]),
      );
      loudest = Math.max(loudest, Math.abs(offline[index]));
      // How far the render is from the clip's plain hits, so a limiter that
      // did nothing in both hosts can't pass.
      const seconds = index / sampleRate;
      const dry =
        seconds >= clipStart && seconds < clipStart + clip.durationSeconds
          ? hits[index - Math.round(clipStart * sampleRate)]
          : 0;
      shaped = Math.max(shaped, Math.abs(offline[index] - dry));
    }
    return { difference, shaped, loudest };
  });
  expect(result.shaped).toBeGreaterThan(0.05);
  // The bus Limiter's −9 dB Ceiling holds the driven hits.
  expect(result.loudest).toBeLessThanOrEqual(10 ** (-9 / 20) + 1e-6);
  expect(result.loudest).toBeGreaterThan(10 ** (-9 / 20) * 0.95);
  expect(result.difference).toBeLessThan(1e-5);
});
