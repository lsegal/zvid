import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The preview pane's Timeline | Media tabs: media opened from the Media
// drawer plays in the Media tab with its own transport, and Space and
// playback follow the active tab. The fixtures are a three-second test
// pattern with a tone and a three-second tone.
const VIDEO = new URL("./fixtures/test-pattern-audio.webm", import.meta.url);
const AUDIO = new URL("./fixtures/tone.wav", import.meta.url);

type Fixture = { url: URL; name: string; type: string };

const VIDEO_FILE = {
  url: VIDEO,
  name: "test-pattern-audio.webm",
  type: "video/webm",
};
const AUDIO_FILE = { url: AUDIO, name: "tone.wav", type: "audio/wav" };

async function dropIntoNewSourceTrack(page: Page, fixtures: Fixture[]) {
  const files = await Promise.all(
    fixtures.map(async ({ url, name, type }) => ({
      base64: (await readFile(url)).toString("base64"),
      name,
      type,
    })),
  );
  const dataTransfer = await page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const { base64, name, type } of files) {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], name, { type }));
    }
    return transfer;
  }, files);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const event of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, event, { dataTransfer });
  }
}

function mediaItem(page: Page, name: string) {
  return page.getByRole("option").filter({ hasText: name });
}

function previewTab(page: Page, name: "Timeline" | "Media") {
  return page.getByRole("tab", { name, exact: true });
}

async function openSession(page: Page, fixtures: Fixture[] = [VIDEO_FILE]) {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropIntoNewSourceTrack(page, fixtures);
  await expect(page.locator(".source-span")).toHaveCount(fixtures.length, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(mediaItem(page, "test-pattern-audio")).toBeVisible();
}

function mediaElement(page: Page) {
  return page.locator(".media-preview video, .media-preview audio");
}

function mediaPaused(page: Page) {
  return mediaElement(page).evaluate(
    (element) => (element as HTMLMediaElement).paused,
  );
}

test("double-clicking media opens it in the Media tab with its own transport", async ({
  page,
}) => {
  await openSession(page);
  await expect(previewTab(page, "Timeline")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".preview-panel__title")).toHaveText("Program");

  // A single click on the Timeline tab leaves the program monitor showing.
  await mediaItem(page, "test-pattern-audio").click();
  await expect(page.locator(".media-preview")).toHaveCount(0);

  await mediaItem(page, "test-pattern-audio").dblclick();
  await expect(previewTab(page, "Media")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".preview-panel__title")).toHaveText(
    "test-pattern-audio.webm",
  );
  const video = page.locator(".media-preview video");
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThan(0);

  // Play and pause. The readout follows the timeline's musical format: three
  // seconds at 120 bpm is a bar and a half.
  const time = page.getByTestId("media-preview-time");
  await expect(time).toHaveText("0.0.0 / 1.2.0");
  await page.getByRole("button", { name: "Play media" }).click();
  await expect(page.getByRole("button", { name: "Pause media" })).toBeVisible();
  await expect.poll(() => mediaPaused(page)).toBe(false);
  await expect(time).not.toHaveText(/^0\.0\.0 /);
  await page.getByRole("button", { name: "Pause media" }).click();
  await expect.poll(() => mediaPaused(page)).toBe(true);

  // Scrubbing moves the media and the readout, here in SMPTE timecode.
  await page.getByRole("button", { name: "SMPTE" }).click();
  await expect(time).toHaveText(/ \/ 00:03:00$/);
  await page.getByRole("slider", { name: "Media position" }).fill("2");
  await expect(time).toHaveText(/^00:02:00 \//);
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeCloseTo(2, 1);

  // The active tab persists across a reload.
  await page.reload();
  await expect(previewTab(page, "Media")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("Space and playback follow the active tab", async ({ page }) => {
  await openSession(page);
  const playTimeline = page.getByRole("button", { name: "Play timeline" });
  const pauseTimeline = page.getByRole("button", { name: "Pause playback" });

  // Timeline tab: Space plays the timeline, with the drawer open.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await expect(pauseTimeline).toBeVisible();
  await page.keyboard.press("Space");
  await expect(playTimeline).toBeVisible();

  // Media tab: Space plays the media, even with focus in the drawer.
  await mediaItem(page, "test-pattern-audio").dblclick();
  await expect(page.locator(".media-preview video")).toBeVisible();
  await page.keyboard.press("Space");
  await expect.poll(() => mediaPaused(page)).toBe(false);
  await expect(playTimeline).toBeVisible();

  // Starting the timeline pauses the media...
  await playTimeline.click();
  await expect(pauseTimeline).toBeVisible();
  await expect.poll(() => mediaPaused(page)).toBe(true);

  // ...and starting the media pauses the timeline.
  await page.getByRole("button", { name: "Play media" }).click();
  await expect.poll(() => mediaPaused(page)).toBe(false);
  await expect(playTimeline).toBeVisible();

  // Switching tabs pauses the tab being left.
  await previewTab(page, "Timeline").click();
  await expect(page.locator(".media-preview")).toHaveCount(0);
  await expect(page.locator(".preview-panel__title")).toHaveText("Program");
  await previewTab(page, "Media").click();
  await expect.poll(() => mediaPaused(page)).toBe(true);

  // Enter on the drawer's selection opens it in the Media tab, like a
  // double-click.
  await previewTab(page, "Timeline").click();
  await mediaItem(page, "test-pattern-audio").click();
  await page.keyboard.press("Enter");
  await expect(previewTab(page, "Media")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("audio-only media shows its waveform and plays", async ({ page }) => {
  await openSession(page, [VIDEO_FILE, AUDIO_FILE]);
  await expect(mediaItem(page, "tone")).toBeVisible();

  await mediaItem(page, "tone").dblclick();
  await expect(page.locator(".preview-panel__title")).toHaveText("tone.wav");
  await expect(page.locator(".preview-panel__mode")).toHaveText("Audio");
  await expect(page.locator(".media-preview video")).toHaveCount(0);
  await expect(page.locator(".media-preview__waveform")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Play media" }).click();
  await expect.poll(() => mediaPaused(page)).toBe(false);

  // Selecting other media while the Media tab is open loads it, paused.
  await mediaItem(page, "test-pattern-audio").click();
  await expect(page.locator(".preview-panel__title")).toHaveText(
    "test-pattern-audio.webm",
  );
  await expect(page.locator(".media-preview video")).toBeVisible();
  await expect.poll(() => mediaPaused(page)).toBe(true);
});
