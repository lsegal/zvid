import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// WebM with VP8 or VP9 video and Opus audio, and Opus audio files, import
// like any other media: their details name the codecs and they play with
// sound. Export can write WebM too: VP8 or VP9 video from the browser's
// encoder and Opus audio from zvidlib, which muxes the file.
const FIXTURES = {
  vp8: new URL("./fixtures/test-pattern-audio.webm", import.meta.url),
  vp9: new URL("./fixtures/test-pattern-audio-vp9.webm", import.meta.url),
  opus: new URL("./fixtures/tone.opus", import.meta.url),
};

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

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

// The mix's highest RMS level over a few reads of the analyser's window, so
// a read between buffers doesn't count.
async function settledLevel(page: Page) {
  let level = 0;
  for (let read = 0; read < 6; read += 1) {
    level = Math.max(
      level,
      await page.evaluate(() => {
        const probe = window as unknown as { analysers: AnalyserNode[] };
        const analyser = probe.analysers.at(-1);
        if (!analyser) return 0;
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        let total = 0;
        for (const sample of samples) total += sample * sample;
        return Math.sqrt(total / samples.length);
      }),
    );
    await page.waitForTimeout(50);
  }
  return level;
}

// Drops the file on the source tracks' header, making a source track of it.
async function importFile(page: Page, file: URL, name: string, type: string) {
  const base64 = (await readFile(file)).toString("base64");
  const dataTransfer = await page.evaluateHandle(
    ({ base64, name, type }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      return transfer;
    },
    { base64, name, type },
  );
  for (const event of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', event, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function drawer(page: Page) {
  return page.getByRole("complementary", { name: "Media" });
}

// The details pane's value for a key, like "Audio".
function detail(page: Page, label: string) {
  return drawer(page)
    .getByRole("region", { name: "Media details" })
    .locator(".media-details__row")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) })
    .locator("dd");
}

const IMPORTS = [
  {
    file: FIXTURES.vp8,
    name: "test-pattern-audio.webm",
    type: "video/webm",
    container: "WebM",
    video: /^VP8 · 320 × 180 · 15 fps$/,
    audio: /^Opus · 48 kHz/,
  },
  {
    file: FIXTURES.vp9,
    name: "test-pattern-audio-vp9.webm",
    type: "video/webm",
    container: "WebM",
    video: /^VP9 · 320 × 180 · 24 fps$/,
    audio: /^Opus · 48 kHz/,
  },
  // No type, as some systems give .opus files, so the extension decides.
  {
    file: FIXTURES.opus,
    name: "tone.opus",
    type: "",
    container: "Ogg",
    video: null,
    audio: /^Opus · 48 kHz · Mono$/,
  },
];

for (const media of IMPORTS) {
  test(`${media.name} imports with its codecs and plays with sound`, async ({
    page,
  }) => {
    await probeAnalysers(page);
    await page.goto("/");
    await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
    await importFile(page, media.file, media.name, media.type);

    await page.getByRole("button", { name: "Media", exact: true }).click();
    await drawer(page)
      .getByRole("option")
      .filter({ hasText: media.name.replace(/\.\w+$/, "") })
      .click();
    await expect(detail(page, "Name")).toHaveText(media.name);
    await expect(detail(page, "Kind")).toHaveText(
      media.video ? /^Video/ : "Audio",
    );
    await expect(detail(page, "Container")).toHaveText(media.container);
    if (media.video) {
      await expect(detail(page, "Video")).toHaveText(media.video);
    } else {
      await expect(detail(page, "Video")).toHaveCount(0);
    }
    await expect(detail(page, "Audio")).toHaveText(media.audio);
    await expect(detail(page, "Duration")).not.toHaveText("—");

    // The fixtures' 440 Hz tones play at about 0.09 RMS.
    await page.getByRole("button", { name: "Jump to timeline start" }).click();
    await page.getByRole("button", { name: "Play timeline" }).click();
    await expect
      .poll(() => settledLevel(page), { timeout: 15_000 })
      .toBeGreaterThan(0.03);
  });
}

// The Matroska CodecID strings of the file's tracks, like "V_VP9".
function codecIds(webm: Buffer) {
  const text = webm.toString("latin1");
  return ["V_VP8", "V_VP9", "A_OPUS", "A_AAC"].filter((id) =>
    text.includes(id),
  );
}

for (const codec of ["vp8", "vp9"] as const) {
  test(`exports ${codec.toUpperCase()} video with Opus audio to WebM`, async ({
    page,
  }) => {
    await page.goto(`/export-smoke.html?codec=${codec}&audioKbps=128`);
    const download = page.waitForEvent("download", { timeout: 120_000 });
    await page.click("#audio");
    await expect(page.locator("#status")).toContainText(
      "Saved smoke-audible.webm",
      { timeout: 120_000 },
    );
    await expect(page.locator("#status")).toContainText(
      `320×180 · 24 fps · ${codec.toUpperCase()}`,
    );
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("smoke-audible.webm");
    const webm = await readFile(await saved.path());
    // An EBML header whose DocType is webm.
    expect([...webm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(webm.subarray(0, 64).toString("latin1")).toContain("webm");
    expect(codecIds(webm)).toEqual([
      codec === "vp8" ? "V_VP8" : "V_VP9",
      "A_OPUS",
    ]);

    // The browser plays it back: two seconds of 320×180 video, and the
    // tone the smoke page mixes, at about its own level.
    const playback = await page.evaluate(
      async (bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: "video/webm" });
        const video = document.createElement("video");
        video.src = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () => reject(new Error("The WebM didn't load."));
        });
        const context = new OfflineAudioContext(1, 48_000, 48_000);
        const audio = await context.decodeAudioData(await blob.arrayBuffer());
        const samples = audio.getChannelData(0);
        let total = 0;
        for (const sample of samples) total += sample * sample;
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          audioSeconds: audio.duration,
          rms: Math.sqrt(total / samples.length),
        };
      },
      [...webm],
    );
    expect(playback.width).toBe(320);
    expect(playback.height).toBe(180);
    expect(playback.duration).toBeCloseTo(2, 1);
    // Gapless: exactly the two seconds of audio that were encoded.
    expect(playback.audioSeconds).toBeCloseTo(2, 2);
    expect(playback.rms).toBeGreaterThan(0.15);
  });
}

test("a VP9 video-only export writes a WebM without audio", async ({
  page,
}) => {
  await page.goto("/export-smoke.html?codec=vp9");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.click("#video");
  await expect(page.locator("#status")).toContainText(
    "Saved smoke-video-only.webm",
    { timeout: 120_000 },
  );
  const webm = await readFile(await (await download).path());
  expect(codecIds(webm)).toEqual(["V_VP9"]);
});
