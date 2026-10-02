import { expect, type Page, test } from "@playwright/test";

// Mono changes what the preview hears, and the preview's chain worklet
// renders it exactly as export's offline chain does.
test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Records the analysers the preview's mixer makes, which measure the mix
// after every effect. An analyser hears a stereo mix as (L+R)/2.
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

// The steadiest level over a few reads, so a read between buffers doesn't
// count.
async function settledLevel(page: Page) {
  let level = 0;
  for (let read = 0; read < 6; read += 1) {
    level = Math.max(level, await mixLevel(page));
    await page.waitForTimeout(50);
  }
  return level;
}

// A 16-bit stereo WAV with a 440 Hz tone on the left and silence on the
// right, so each Source setting sounds different.
function leftToneWav(seconds: number) {
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
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 4);
  }
  return wav.toString("base64");
}

async function addSourceAudio(page: Page, base64: string) {
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "left-tone.wav", { type: "audio/wav" }),
    );
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// The level while playing from the session start, once it settles.
async function playingLevel(page: Page) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  const play = page.getByRole("button", { name: "Play timeline" });
  if (await play.isVisible()) {
    await play.click();
  }
  // Long enough for the chain's ramps and the analyser's window.
  await page.waitForTimeout(400);
  return settledLevel(page);
}

test("Mono's Source and Amount move the preview's level", async ({ page }) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceAudio(page, leftToneWav(30));

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  await page.getByRole("menu").getByRole("menuitem", { name: /^Mono/ }).click();
  const mono = page.locator(
    '.fx-chain .fx-device-panel[data-fx-group="clip"][aria-label="Mono"]',
  );
  await expect(mono).toHaveCount(1);
  const source = mono.getByRole("group", { name: "Source" });

  // The tone is about 0.22 RMS on its own side. Sum puts half of it on
  // both sides, which the analyser hears as 0.11; Left puts all of it on
  // both, 0.22; Right puts the silent side on both.
  await expect
    .poll(() => playingLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(0.08);
  const sum = await playingLevel(page);
  expect(sum).toBeLessThan(0.14);

  await source.getByRole("button", { name: "Left" }).click();
  await expect
    .poll(() => playingLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(sum * 1.6);

  await source.getByRole("button", { name: "Right" }).click();
  await expect
    .poll(() => playingLevel(page), { timeout: 15_000 })
    .toBeLessThan(0.01);

  // At 0 % the original stereo passes: the analyser hears the tone's half
  // again.
  await mono.getByRole("slider", { name: "Amount" }).press("Home");
  await expect(mono.getByRole("slider", { name: "Amount" })).toHaveAttribute(
    "aria-valuetext",
    "0%",
  );
  await expect
    .poll(
      async () => {
        const level = await playingLevel(page);
        return level > sum * 0.8 && level < sum * 1.25;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("the preview's chain worklet renders Mono as export does", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { AudioChain, BLOCK_FRAMES } = await load("/src/audio-mix/chain.ts");
    const { CHAIN_WORKLET_URL } = await load(
      "/src/audio-mix/chain-worklet-url.ts",
    );
    const { createChainNode, postChainMessage } = await load(
      "/src/audio-mix/chain-node.ts",
    );
    const { AUDIO_PROCESSORS } = await load("/src/audio-mix/processors.ts");
    const { DEFAULT_TIME_SIGNATURE } = await load(
      "/src/audio-mix/processor.ts",
    );

    const sampleRate = 48_000;
    const length = sampleRate;
    // The signal starts after a silent lead-in, on a block boundary. The
    // render pauses halfway through it to hand the worklet its settings,
    // since an offline render can finish before a message arrives.
    const leadIn = 40 * BLOCK_FRAMES;
    const tempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
    const settings = {
      stages: [
        {
          id: "mono",
          effectName: "Mono",
          enabled: true,
          numbers: { Amount: 0.6 },
          switches: { Source: "Sum" },
        },
      ],
      inputGain: 1,
      delayFrames: 0,
    };
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let index = leadIn; index < length; index++) {
      left[index] = 0.5 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
      right[index] = 0.3 * Math.sin((2 * Math.PI * 97 * index) / sampleRate);
    }

    // The preview's host: the chain worklet in an offline context.
    const context = new OfflineAudioContext(2, length, sampleRate);
    await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
    const buffer = context.createBuffer(2, length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const sourceNode = context.createBufferSource();
    sourceNode.buffer = buffer;
    const node = createChainNode(context, 2);
    sourceNode.connect(node).connect(context.destination);
    sourceNode.start();
    context.suspend(leadIn / 2 / sampleRate).then(async () => {
      postChainMessage(node, { type: "configure", settings, tempo });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await context.resume();
    });
    const rendered = await context.startRendering();

    // Export's host: the chain run block by block in JS.
    const chain = new AudioChain(AUDIO_PROCESSORS, sampleRate, 2);
    chain.configure(settings, tempo);
    const expected = [new Float32Array(length), new Float32Array(length)];
    for (let start = 0; start < length; start += BLOCK_FRAMES) {
      const end = Math.min(length, start + BLOCK_FRAMES);
      chain.process(
        [left.subarray(start, end), right.subarray(start, end)],
        expected.map((channel) => channel.subarray(start, end)),
        end - start,
        start / sampleRate,
      );
    }

    let largest = 0;
    let energy = 0;
    for (let channel = 0; channel < 2; channel++) {
      const actual = rendered.getChannelData(channel);
      for (let index = leadIn; index < length; index++) {
        largest = Math.max(
          largest,
          Math.abs(actual[index] - expected[channel][index]),
        );
        energy += actual[index] ** 2;
      }
    }
    // Amount 0.6 moves each side toward the other, so they differ less
    // than the input's sides do.
    let sideDifference = 0;
    for (let index = leadIn; index < length; index++) {
      sideDifference = Math.max(
        sideDifference,
        Math.abs(
          rendered.getChannelData(0)[index] - rendered.getChannelData(1)[index],
        ),
      );
    }
    return { largest, energy, sideDifference };
  });

  expect(result.energy).toBeGreaterThan(1);
  expect(result.largest).toBeLessThan(1e-6);
  // The input's sides differ by up to 0.8; 40 % of that is left.
  expect(result.sideDifference).toBeLessThan(0.33);
  expect(result.sideDifference).toBeGreaterThan(0.25);
});
