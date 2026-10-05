import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// The Phaser audio effect: added from a clip's add menu, in its Audio
// group, with its controls at their defaults, and notching what the
// preview mix plays.
test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Records the analysers the preview's mixer makes, which measure the mix
// after every clip's effects.
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

async function addTone(page: Page, seconds: number) {
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, toneWav(seconds));
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

async function playFromStart(page: Page) {
  await page.getByRole("button", { name: "Jump to timeline start" }).click();
  await page.getByRole("button", { name: "Play timeline" }).click();
}

const phaserDevice = (page: Page) =>
  page.locator(
    '.fx-chain .fx-device-panel[data-fx-group="clip"][aria-label="Phaser"]',
  );

// Types `value` into a knob's readout.
async function setKnob(page: Page, label: string, value: string) {
  const device = phaserDevice(page);
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("Phaser is added from a clip's Audio menu with its defaults and notches the mix", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // Long enough to keep playing through every check.
  await addTone(page, 30);

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  // An audio clip is offered only audio effects, so its menu needs no
  // Audio heading.
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Modulation & Delay" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Phaser/ }).click();

  const device = phaserDevice(page);
  await expect(device).toHaveCount(1);
  await expect(device.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    device.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  for (const [label, text] of [
    ["Rate", "0.50 Hz"],
    ["Depth", "70%"],
    ["Center", "1.00 kHz"],
    ["Feedback", "30%"],
    ["Mix", "50%"],
  ]) {
    await expect(device.getByRole("slider", { name: label })).toHaveAttribute(
      "aria-valuetext",
      text,
    );
  }
  const stages = device.getByRole("group", { name: "Stages" });
  for (const option of ["2", "4", "6", "8", "12"]) {
    await expect(
      stages.getByRole("button", { name: option, exact: true }),
    ).toHaveAttribute("aria-pressed", option === "4" ? "true" : "false");
  }

  // At Mix 0 the tone plays at its full level.
  await setKnob(page, "Mix", "0");
  await playFromStart(page);
  let dry = 0;
  await expect
    .poll(
      async () => {
        dry = await settledLevel(page);
        return dry;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.02);

  // Two still stages notch at Center: centered on the tone, half wet
  // cancels it.
  await stages.getByRole("button", { name: "2", exact: true }).click();
  await setKnob(page, "Depth", "0");
  await setKnob(page, "Feedback", "0");
  await setKnob(page, "Center", "440");
  await setKnob(page, "Mix", "50");
  await expect(device.getByRole("slider", { name: "Mix" })).toHaveAttribute(
    "aria-valuetext",
    "50%",
  );
  await expect
    .poll(() => settledLevel(page), { timeout: 15_000 })
    .toBeLessThan(dry * 0.2);

  // Bypassing it brings the tone back to its full level.
  await device.getByRole("button", { name: "Bypass Phaser" }).click();
  await expect
    .poll(() => settledLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(dry * 0.8);
});

test("a video clip's add menu lists Phaser in its Audio group", async ({
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
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(
      '[data-source-track-drop-target="new-track"]',
      type,
      { dataTransfer },
    );
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("group", { name: "Video" }).getByRole("menuitem", {
      name: "Modulation & Delay",
    }),
  ).toHaveCount(0);
  await menu
    .getByRole("group", { name: "Audio" })
    .getByRole("menuitem", { name: "Modulation & Delay" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Phaser/ }).click();
  await expect(phaserDevice(page)).toHaveCount(1);
});

// Renders a 440 Hz tone through Phaser with `numbers` and `stages` both as
// an export does and through a lone chain, and the still sweep's analytic
// level for comparison.
function renderBoth(
  page: Page,
  numbers: Record<string, number>,
  stages: string,
) {
  return page.evaluate(
    async ({ numbers, stages }) => {
      // Variables, so the type checker doesn't resolve the dev server paths.
      const offlinePath = "/src/audio-mix/offline.ts";
      const chainPath = "/src/audio-mix/chain.ts";
      const processorsPath = "/src/audio-mix/processors.ts";
      const phaserPath = "/src/fx/effects/phaser/phaser.ts";
      const { renderAudioMixOffline } = await import(offlinePath);
      const { AudioChain, BLOCK_FRAMES } = await import(chainPath);
      const { AUDIO_PROCESSORS } = await import(processorsPath);
      const { phaserResponseDb } = await import(phaserPath);

      const sampleRate = 48_000;
      const length = sampleRate * 2;
      // A 440 Hz tone at 0.3 as a 16-bit WAV, below the limiter's knee
      // whatever the Phaser does to it.
      const wav = new DataView(new ArrayBuffer(44 + length * 2));
      const ascii = (offset: number, text: string) => {
        for (let index = 0; index < text.length; index++) {
          wav.setUint8(offset + index, text.charCodeAt(index));
        }
      };
      ascii(0, "RIFF");
      wav.setUint32(4, wav.byteLength - 8, true);
      ascii(8, "WAVEfmt ");
      wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true);
      wav.setUint16(22, 1, true);
      wav.setUint32(24, sampleRate, true);
      wav.setUint32(28, sampleRate * 2, true);
      wav.setUint16(32, 2, true);
      wav.setUint16(34, 16, true);
      ascii(36, "data");
      wav.setUint32(40, length * 2, true);
      for (let index = 0; index < length; index++) {
        const sample = 0.3 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
        wav.setInt16(44 + index * 2, Math.round(sample * 32767), true);
      }
      const url = URL.createObjectURL(new Blob([wav.buffer]));

      const stage = {
        id: "phaser",
        effectName: "Phaser",
        enabled: true,
        numbers,
        switches: { Stages: stages },
      };
      const signature = { numerator: 4, denominator: 4 };
      const mix = {
        clips: [
          {
            id: "clip",
            mediaId: "tone",
            startSeconds: 0,
            durationSeconds: 2,
            sourceOffsetSeconds: 0,
            sourceWindowStartSeconds: 0,
            sourceWindowEndSeconds: 2,
            effects: [],
            amplitude: 1,
            hasGain: true,
            busId: "bus",
            stages: [stage],
          },
        ],
        buses: [{ id: "bus", stages: [] }],
        master: [],
        masterAmplitude: 1,
        fromSourceTracks: true,
        bpm: 120,
        signature,
      };
      const [exported] = await renderAudioMixOffline(
        mix,
        [{ id: "tone", previewUrl: url }],
        { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
      );

      // The same tone, decoded the same way, through a lone chain.
      const context = new OfflineAudioContext(1, 1, sampleRate);
      const decoded = await context.decodeAudioData(
        await (await fetch(url)).arrayBuffer(),
      );
      const input = decoded.getChannelData(0);
      const chain = new AudioChain(AUDIO_PROCESSORS, sampleRate, 1);
      chain.configure(
        { stages: [stage], inputGain: 1, delayFrames: 0 },
        { bpm: 120, signature },
      );
      const direct = new Float32Array(length);
      const block = [new Float32Array(BLOCK_FRAMES)];
      for (let start = 0; start < length; start += BLOCK_FRAMES) {
        const frames = Math.min(BLOCK_FRAMES, length - start);
        const source = new Float32Array(BLOCK_FRAMES);
        source.set(input.subarray(start, start + frames));
        chain.process([source], block, frames, start / sampleRate);
        direct.set(block[0].subarray(0, frames), start);
      }

      const rms = (samples: Float32Array) => {
        let total = 0;
        for (let index = length / 2; index < length; index++) {
          total += samples[index] * samples[index];
        }
        return Math.sqrt(total / (length / 2));
      };
      let difference = 0;
      for (let index = 0; index < length; index++) {
        difference = Math.max(
          difference,
          Math.abs(exported[index] - direct[index]),
        );
      }
      return {
        difference,
        gainDb: 20 * Math.log10(rms(exported) / rms(input)),
        expectedDb: phaserResponseDb(
          {
            hz: numbers.Center,
            stages: Number(stages),
            feedback: numbers.Feedback,
            mix: numbers.Mix,
          },
          440,
          sampleRate,
        ),
      };
    },
    { numbers, stages },
  );
}

test("the export's offline render runs Phaser exactly as the chain does", async ({
  page,
}) => {
  await page.goto("/");
  // Sweeping, the export's LFO follows the timeline as the chain's does.
  const swept = await renderBoth(
    page,
    { Rate: 2, Depth: 100, Center: 800, Feedback: 60, Mix: 50 },
    "6",
  );
  expect(swept.difference).toBeLessThanOrEqual(1e-5);

  // Still, the level matches the analytic response.
  const still = await renderBoth(
    page,
    { Rate: 0.5, Depth: 0, Center: 1000, Feedback: 30, Mix: 50 },
    "4",
  );
  expect(still.difference).toBeLessThanOrEqual(1e-5);
  expect(Math.abs(still.gainDb - still.expectedDb)).toBeLessThan(0.2);
});
