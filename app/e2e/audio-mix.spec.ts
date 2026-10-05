import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The preview hears an additive mix of the contributing clips, each through
// its own Gain: with no layer clips, every source clip with audio. A clip
// whose Gain is muted drops out of the mix. A session with only Gain plays
// through native gains, as it did before the audio effect chain, without
// loading the chain worklet.
const VIDEO = new URL("./fixtures/test-pattern-audio.webm", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Records the analysers the preview's mixer makes, which measure the mix
// after every Gain and before the preview volume, and the worklet modules
// it loads.
async function probeAnalysers(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as {
      analysers: AnalyserNode[];
      outputs: GainNode[];
      worklets: string[];
    };
    probe.analysers = [];
    probe.outputs = [];
    probe.worklets = [];
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (
      this: AudioWorklet,
      url: string | URL,
      options?: WorkletOptions,
    ) {
      probe.worklets.push(String(url));
      return addModule.call(this, url, options);
    };
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function (this: AudioContext) {
      const analyser = createAnalyser.call(this);
      probe.analysers.push(analyser);
      const connect = analyser.connect.bind(analyser) as (
        node: AudioNode,
      ) => AudioNode;
      analyser.connect = ((node: AudioNode) => {
        if (node instanceof GainNode) {
          probe.outputs.push(node);
        }
        return connect(node);
      }) as typeof analyser.connect;
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

type DroppedFile = { name: string; type: string; base64: string };

const tone = (seconds = 3): DroppedFile => ({
  name: "tone.wav",
  type: "audio/wav",
  base64: toneWav(seconds),
});

// A test pattern with a loud soundtrack. Unlike an audio file, a video
// clip's effects can be edited.
const video = async (): Promise<DroppedFile> => ({
  name: "test-pattern-audio.webm",
  type: "video/webm",
  base64: (await readFile(VIDEO)).toString("base64"),
});

// Drops `file` into a new source track, the `count`th.
async function addSourceTrack(page: Page, count: number, file: DroppedFile) {
  const dataTransfer = await page.evaluateHandle(({ name, type, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type }));
    return transfer;
  }, file);
  // The first track comes from a drop on the source tracks' header; later
  // ones from the new-track row that dragging over a track shows.
  const dispatch = async (target: string, types: string[]) => {
    for (const type of types) {
      await page.dispatchEvent(target, type, { dataTransfer });
    }
  };
  if (count === 1) {
    await dispatch('[aria-label="Source track drop area"]', [
      "dragenter",
      "dragover",
      "drop",
    ]);
  } else {
    await dispatch('[data-source-track-drop-target="track"]', [
      "dragenter",
      "dragover",
    ]);
    await dispatch(".track-row--source-drop", [
      "dragenter",
      "dragover",
      "drop",
    ]);
  }
  await expect(page.locator(".source-span")).toHaveCount(count, {
    timeout: 30_000,
  });
}

// Plays from the session start, where every clip begins.
async function playFromStart(page: Page) {
  await page.getByRole("button", { name: "Jump to timeline start" }).click();
  await page.getByRole("button", { name: "Play timeline" }).click();
}

// Stops playback, which a three-second session may already have done
// under load.
async function pause(page: Page) {
  await page
    .getByRole("button", { name: "Pause playback" })
    .click({ timeout: 2_000 })
    .catch(() => {});
  await expect(
    page.getByRole("button", { name: "Play timeline" }),
  ).toBeVisible();
}

test("two source clips play as one mix, and muting a clip's Gain drops it out", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceTrack(page, 1, await video());
  await addSourceTrack(page, 2, tone());

  await playFromStart(page);
  let both = 0;
  await expect
    .poll(
      async () => {
        both = await settledLevel(page);
        return both;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.2);
  await pause(page);

  // Muting the video clip's own Gain leaves only the tone, about 0.22 RMS
  // against the soundtrack's 0.47.
  await page.locator(".source-span").first().click();
  const clipGain = page.locator('.fx-chain [data-fx-group="clip"]');
  await clipGain.getByRole("button", { name: /^Mute / }).click();
  await expect(
    clipGain.getByRole("button", { name: /^Mute / }),
  ).toHaveAttribute("aria-pressed", "true");

  // Both bounds hold in one read, so the drop isn't playback ending.
  await playFromStart(page);
  await expect
    .poll(
      async () => {
        const level = await settledLevel(page);
        return level > 0.1 && level < both * 0.75;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await pause(page);

  // Gain alone never needs the chain worklet.
  const worklets = await page.evaluate(
    () => (window as unknown as { worklets: string[] }).worklets,
  );
  expect(worklets).toEqual([]);
});

test("the preview volume turns the mix down after the analyser", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // Long enough to keep playing through every check.
  await addSourceTrack(page, 1, tone(30));

  await playFromStart(page);
  await expect
    .poll(() => settledLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(0.02);
  const outputLevel = () =>
    page.evaluate(() => {
      const probe = window as unknown as { outputs: GainNode[] };
      const output = probe.outputs.at(-1);
      return output ? Math.round(output.gain.value * 100) / 100 : null;
    });
  await expect.poll(outputLevel).toBe(1);

  const slider = page.getByRole("slider", { name: "Preview volume" });
  await slider.fill("0.3");
  await expect.poll(outputLevel).toBe(0.3);
  // The analyser, which audio-reactive effects follow, still hears the mix
  // at full level.
  await expect
    .poll(() => settledLevel(page), { timeout: 15_000 })
    .toBeGreaterThan(0.02);
  await page.getByRole("button", { name: "Mute preview" }).click();
  await expect.poll(outputLevel).toBe(0);
  await page.getByRole("button", { name: "Unmute preview" }).click();
  await expect.poll(outputLevel).toBe(0.3);
});
