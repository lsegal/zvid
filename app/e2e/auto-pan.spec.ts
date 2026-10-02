import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Auto Pan is added from an audio clip's add menu, shows its defaults, and
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
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
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
  }, toneWav(8));
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

test("Auto Pan is added to an audio clip with its defaults and pans the mix", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addTone(page);
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
    .getByRole("menuitem", { name: "Volume & Stereo" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Auto Pan/ }).click();
  await expect(page.locator(clipDevices)).toHaveCount(2);

  const autoPan = page.locator(clipDevices).nth(1);
  await expect(autoPan).toHaveAttribute("aria-label", "Auto Pan");
  await expect(
    autoPan.getByRole("img", { name: "Audio effect" }),
  ).toBeVisible();
  await expect(
    autoPan.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);

  // Synced by default: Note shows and Rate hides.
  const sync = autoPan.getByRole("group", { name: "Sync" });
  await expect(sync.getByRole("button", { name: "On" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(autoPan.getByRole("combobox", { name: "Note" })).toHaveText(
    /1 bar/,
  );
  await expect(autoPan.getByRole("slider", { name: "Rate" })).toHaveCount(0);
  await expect(autoPan.getByRole("slider", { name: "Depth" })).toHaveAttribute(
    "aria-valuetext",
    "100%",
  );
  const shape = autoPan.getByRole("group", { name: "Shape" });
  await expect(shape.getByRole("button", { name: "Sine" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Free-running, Rate shows at 1 Hz and Note hides.
  await sync.getByRole("button", { name: "Off" }).click();
  await expect(autoPan.getByRole("slider", { name: "Rate" })).toHaveAttribute(
    "aria-valuetext",
    "1.0 Hz",
  );
  await expect(autoPan.getByRole("combobox", { name: "Note" })).toHaveCount(0);

  // A 0.05 Hz square holds the tone hard right for the clip's 8 s. The
  // analyser hears left and right averaged, so a centered tone at unity in
  // both reads √2 louder than one at √2 in the right alone.
  await typeValue(page, "Auto Pan", "Rate", "0.05");
  await shape.getByRole("button", { name: "Square" }).click();

  await autoPan.getByRole("button", { name: "Bypass Auto Pan" }).click();
  const dry = await playingLevel(page);
  expect(dry).toBeGreaterThan(0.1);

  await autoPan.getByRole("button", { name: "Enable Auto Pan" }).click();
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeLessThan(dry * 0.85);

  // Back in the center at Depth 0 %.
  await typeValue(page, "Auto Pan", "Depth", "0");
  await expect
    .poll(() => playingLevel(page), { timeout: 30_000 })
    .toBeGreaterThan(dry * 0.9);
});

test("a video clip's add menu lists Auto Pan in its Audio group", async ({
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
  await page.getByRole("menuitem", { name: /^Auto Pan/ }).click();
  await expect(
    page.locator(clipDevices).filter({ hasText: "Auto Pan" }),
  ).toHaveCount(1);
});

type StoredParameter = { key: string; value: string; numericValue?: number };

const RENDERS: [string, StoredParameter[]][] = [
  [
    "synced",
    [
      { key: "Sync", value: "On" },
      { key: "Note", value: "1/4T" },
      { key: "Shape", value: "Triangle" },
    ],
  ],
  [
    "free-running",
    [
      { key: "Sync", value: "Off" },
      { key: "Rate", value: "3", numericValue: 3 },
      { key: "Depth", value: "0.8", numericValue: 0.8 },
      { key: "Shape", value: "Square" },
    ],
  ],
];

for (const [name, parameters] of RENDERS) {
  test(`the preview's worklet and the export's offline render play ${name} Auto Pan identically`, async ({
    page,
  }) => {
    await page.goto("/");
    const difference = await page.evaluate(async (parameters) => {
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
      // Rendering from timeline second 3.25 checks both hosts take the LFO
      // phase from the timeline.
      const startSeconds = 3.25;
      const tempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
      const stage = audioStageOf(
        {
          id: "auto-pan",
          trackId: "track",
          effectName: "Auto Pan",
          parameters,
        },
        "auto-pan",
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
    }, parameters);
    // Auto Pan did change the signal, and both hosts agree.
    expect(difference.wet).toBeGreaterThan(0.05);
    expect(difference.max).toBeLessThan(1e-5);
  });
}
