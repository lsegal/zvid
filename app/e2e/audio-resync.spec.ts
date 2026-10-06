import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Steady preview playback never re-seeks its media: each seek is an audible
// gap, and iOS Safari reported choppy audio (#1111). With `?debugAudio=1`
// the preview counts its re-syncs, and the diagnostics panel reports them.
// This spec also runs in WebKit (PLAYWRIGHT_WEBKIT=1, see
// playwright.config.ts), the engine iOS uses.
const VIDEO = new URL(
  "./fixtures/test-pattern-audio-16s.webm",
  import.meta.url,
);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// How long playback runs before the steady window, and the window itself.
const STARTUP_MS = 2_000;
const STEADY_MS = 10_000;

type Snapshot = {
  contextCount: number;
  contexts: { state: string }[];
  voices: { kind: string; paused: boolean }[];
  steadyResyncs: number;
  drift: number[];
};

type DroppedFile = { name: string; type: string; base64: string };

// A 440 Hz tone as a 16-bit mono WAV.
function tone(seconds: number): DroppedFile {
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
  return {
    name: "tone.wav",
    type: "audio/wav",
    base64: wav.toString("base64"),
  };
}

// Drops `file` into the first source track.
async function addSourceTrack(page: Page, file: DroppedFile) {
  const dataTransfer = await page.evaluateHandle(({ name, type, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type }));
    return transfer;
  }, file);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// Records the analysers the preview makes, which hear the mix.
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
    const analyser = (
      window as unknown as { analysers: AnalyserNode[] }
    ).analysers.at(-1);
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

function snapshot(page: Page) {
  return page.evaluate(() => {
    const diagnostics = (
      window as unknown as {
        zvidAudioDiagnostics: { snapshot(): unknown };
      }
    ).zvidAudioDiagnostics;
    return diagnostics.snapshot();
  }) as Promise<Snapshot>;
}

// Plays `file` from the start, then counts the re-syncs over a steady
// window once start-up is over.
async function steadyPlayback(page: Page, file: DroppedFile) {
  await page.goto("/?debugAudio=1");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceTrack(page, file);
  await page.getByRole("button", { name: "Jump to timeline start" }).click();
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect
    .poll(
      async () => {
        const { contexts, voices } = await snapshot(page);
        return (
          contexts.some((context) => context.state === "running") &&
          voices.some((voice) => !voice.paused)
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.waitForTimeout(STARTUP_MS);
  await page
    .getByRole("region", { name: "Audio diagnostics" })
    .getByRole("button", { name: "Reset counters" })
    .click();
  await page.waitForTimeout(STEADY_MS);
  const steady = await snapshot(page);
  console.log(
    test.info().project.name,
    test.info().title,
    JSON.stringify(steady),
  );
  // Still playing, so the window was steady playback throughout.
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();
  return steady;
}

test("steady playback of an audio clip makes no re-syncs", async ({
  page,
  browserName,
}) => {
  await probeAnalysers(page);
  const steady = await steadyPlayback(page, tone(STARTUP_MS / 1000 + 16));
  expect(steady.contextCount).toBe(1);
  // WebKit plays an audio-only clip from a decoded buffer, other browsers
  // from its media element.
  expect(steady.voices.map((voice) => voice.kind)).toEqual([
    browserName === "webkit" ? "buffer" : "audio",
  ]);
  expect(steady.drift.length).toBeGreaterThan(0);
  expect(steady.steadyResyncs).toBeLessThanOrEqual(1);
  // The tone is heard: about 0.22 RMS.
  await expect.poll(() => mixLevel(page)).toBeGreaterThan(0.1);
  const panel = page.getByRole("region", { name: "Audio diagnostics" });
  await expect(panel).toContainText("AudioContexts: 1");
  await expect(panel).toContainText("Re-syncs:");
  await expect(panel).toContainText(/User agent: \S/);
});

test("steady playback of a video clip makes no re-syncs", async ({ page }) => {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const steady = await steadyPlayback(page, {
    name: "test-pattern-audio.webm",
    type: "video/webm",
    base64,
  });
  expect(steady.voices.some((voice) => voice.kind === "video")).toBe(true);
  expect(steady.steadyResyncs).toBeLessThanOrEqual(1);
});

test("steady playback on a busy main thread makes no re-syncs", async ({
  page,
}) => {
  // Blocks the main thread for 40 ms of every 100 ms, as compositor frames
  // and thumbnail decoding can on a phone.
  await page.addInitScript(() => {
    window.setInterval(() => {
      const until = performance.now() + 40;
      while (performance.now() < until) {
        // Busy.
      }
    }, 100);
  });
  const steady = await steadyPlayback(page, tone(STARTUP_MS / 1000 + 16));
  expect(steady.steadyResyncs).toBeLessThanOrEqual(1);
});
