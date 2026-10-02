import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// The Audio row is a read-only waveform of the resolved audio mix: it takes
// no files, draws the clips that render audio at their Gain, and recomputes
// on Refresh. Sessions that had a main audio open with it on a source track.
const VIDEO = new URL("./fixtures/test-pattern-audio.webm", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

function audioRow(page: Page) {
  return page.locator("[data-audio-row]");
}

function mixContent(page: Page) {
  return audioRow(page).locator("[data-audio-mix]");
}

// The mix's loudest point as the Audio row drew it.
async function drawnLevel(page: Page) {
  return Number(await mixContent(page).getAttribute("data-audio-mix-level"));
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
  return wav;
}

// Drops a test pattern with a loud soundtrack into a new source track. Unlike
// an audio file, a video clip's effects can be edited.
async function addVideoTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern-audio.webm", { type: "video/webm" }),
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

// Records the analysers the preview's mixer makes, which hear the mix.
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

// The loudest RMS level of the mix over a few reads.
async function playedLevel(page: Page) {
  let level = 0;
  for (let read = 0; read < 6; read += 1) {
    level = Math.max(
      level,
      await page.evaluate(() => {
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
      }),
    );
    await page.waitForTimeout(50);
  }
  return level;
}

test("the Audio row takes no files and starts empty", async ({ page }) => {
  await page.goto("/");
  await expect(audioRow(page)).toContainText("No audio");
  await expect(audioRow(page).locator('input[type="file"]')).toHaveCount(0);
  await expect(
    audioRow(page).getByRole("button", { name: "Recompute audio" }),
  ).toBeVisible();
  await expect(
    audioRow(page).getByRole("button", { name: /main audio/i }),
  ).toHaveCount(0);

  await audioRow(page).locator(".track-label").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Audio actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Recompute audio"]);
  await page.keyboard.press("Escape");
});

test("a source clip with audio draws the mix, its muted Gain flattens it, and Refresh recomputes it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addVideoTrack(page);

  await expect(audioRow(page)).toContainText("From source tracks · 1 clip");
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });
  await expect(
    mixContent(page).locator(".waveform__canvas").first(),
  ).toBeVisible();
  await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);

  // Refresh resolves the mix again and draws it anew.
  await audioRow(page).getByRole("button", { name: "Recompute audio" }).click();
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "computing");
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });
  await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);

  // Muting the clip's Gain flattens its waveform.
  await page.locator(".source-span").first().click();
  const clipGain = page.locator('.fx-chain [data-fx-group="clip"]');
  await clipGain.getByRole("button", { name: /^Mute / }).click();
  await expect(
    clipGain.getByRole("button", { name: /^Mute / }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });
  await expect.poll(() => drawnLevel(page)).toBe(0);
  // The muted clip still counts toward the mix.
  await expect(audioRow(page)).toContainText("From source tracks · 1 clip");
});

test("a session with a main audio opens with it on a new source track, which plays", async ({
  page,
}) => {
  await probeAnalysers(page);
  const folder = await mkdtemp(join(tmpdir(), "zvid-main-audio-"));
  try {
    await writeFile(join(folder, "Song.wav"), toneWav(3));
    await writeFile(
      join(folder, "Old Song.lvp"),
      JSON.stringify({
        timeline: { bpm: 120, fps: 30, projectDuration: 90 },
        mainTracks: [{ id: "1", name: "Layer 1" }],
        tracks: [],
        clips: [],
        selections: [],
        effects: [],
        audioFilename: "Song.wav",
      }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: "File", exact: true }).click();
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Open Workspace" }).click();
    await (await choosing).setFiles(folder);

    // The main audio is now a source track named after its file, with one
    // clip, and the Audio row draws it.
    await expect(page.locator(".track-label--source")).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.locator(".track-label--source")).toContainText("Song");
    await expect(page.locator(".source-span")).toHaveCount(1);
    await expect(audioRow(page)).toContainText("From source tracks · 1 clip");
    await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
      timeout: 30_000,
    });
    await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);

    // It plays through its 0 dB Gain.
    await page.getByRole("button", { name: "Play timeline" }).click();
    await expect
      .poll(() => playedLevel(page), { timeout: 15_000 })
      .toBeGreaterThan(0.02);
    await page.getByRole("button", { name: "Pause playback" }).click();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
