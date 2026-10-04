import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Audio-only clips, on layers and in source tracks, draw their waveform like
// the Audio lane instead of a filmstrip, behind a quiet border that turns to
// the full accent border on hover; a trim handle shows when it is hovered.
// The fixture is a three-second tone.
const AUDIO = new URL("./fixtures/tone.wav", import.meta.url);
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

async function dropIntoNewSourceTrack(
  page: Page,
  url: URL,
  name: string,
  type: string,
) {
  const base64 = (await readFile(url)).toString("base64");
  const dataTransfer = await page.evaluateHandle(
    ({ base64, name, type }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      return transfer;
    },
    { base64, name, type },
  );
  const target = '[data-source-track-drop-target="new-track"]';
  for (const event of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, event, { dataTransfer });
  }
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function copySpanToLayer(span: Locator, layer: string) {
  const page = span.page();
  await span.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: layer }).click();
}

async function expectOpacity(locator: Locator, opacity: string) {
  await expect
    .poll(() =>
      locator.evaluate((element) => getComputedStyle(element).opacity),
    )
    .toBe(opacity);
}

// The alpha of an element's top border color, 0-1.
function borderAlpha(locator: Locator) {
  return locator.evaluate((element) => {
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) {
      throw new Error("no 2d context");
    }
    probe.fillStyle = getComputedStyle(element).borderTopColor;
    probe.clearRect(0, 0, 1, 1);
    probe.fillRect(0, 0, 1, 1);
    return probe.getImageData(0, 0, 1, 1).data[3] / 255;
  });
}

// How many columns of a waveform canvas have anything drawn in them.
function drawnColumns(canvas: Locator) {
  return canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) {
      return 0;
    }
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let columns = 0;
    for (let x = 0; x < canvas.width; x += 1) {
      for (let y = 0; y < canvas.height; y += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          columns += 1;
          break;
        }
      }
    }
    return columns;
  });
}

test("audio-only clips draw a waveform with a quiet border", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropIntoNewSourceTrack(page, AUDIO, "tone.wav", "audio/wav");

  // The source clip.
  const span = page.locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  await expect(span).toHaveClass(/source-span--audio/, { timeout: 30_000 });
  const spanWaveform = span.locator("canvas.source-span__waveform");
  await expect(spanWaveform).toHaveCount(1, { timeout: 30_000 });
  await expect(span.locator(".source-span__filmstrip")).toHaveCount(0);
  await expect.poll(() => drawnColumns(spanWaveform)).toBeGreaterThan(20);
  await page.mouse.move(5, 5);
  const spanStart = span.locator(".source-span__handle--start");
  const spanEnd = span.locator(".source-span__handle--end");
  await expect.poll(() => borderAlpha(span)).toBeLessThan(0.5);
  await expectOpacity(spanStart, "0");
  await expectOpacity(spanEnd, "0");
  await span.hover();
  await expect.poll(() => borderAlpha(span)).toBe(1);
  await expectOpacity(spanStart, "0");
  await expectOpacity(spanEnd, "0");
  await spanStart.hover();
  await expectOpacity(spanStart, "1");
  await expectOpacity(spanEnd, "0");

  // The layer clip.
  await copySpanToLayer(span, "Layer 1");
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await expect(clip).toHaveClass(/clip-card--audio/);
  const waveform = clip.locator("canvas.clip-card__waveform");
  await expect(waveform).toHaveCount(1);
  await expect(clip.locator(".clip-card__filmstrip")).toHaveCount(0);
  await expect(clip.locator(".clip-card__thumb")).toHaveCount(0);
  await expect.poll(() => drawnColumns(waveform)).toBeGreaterThan(20);

  // Idle: a quiet border and hidden handles, even once deselected.
  await page.keyboard.press("Escape");
  await clip.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.mouse.move(5, 5);
  const start = clip.locator(".clip-card__handle--start");
  const end = clip.locator(".clip-card__handle--end");
  await expect.poll(() => borderAlpha(clip)).toBeLessThan(0.5);
  await expectOpacity(start, "0");
  await expectOpacity(end, "0");

  // Hover: the full border, and only the hovered handle.
  await clip.hover();
  await expect.poll(() => borderAlpha(clip)).toBe(1);
  await expectOpacity(start, "0");
  await expectOpacity(end, "0");
  await start.hover();
  await expectOpacity(start, "1");
  await expectOpacity(end, "0");

  // Trimming the start redraws the waveform for the shorter range.
  const widthBefore = await waveform.evaluate(
    (element) => (element as HTMLCanvasElement).width,
  );
  const box = await start.boundingBox();
  if (!box) {
    throw new Error("start handle is not visible");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });
  await expect(clip).toHaveClass(/clip-card--trimming/);
  await expect.poll(() => borderAlpha(clip)).toBe(1);
  await page.mouse.up();
  await expect
    .poll(() =>
      waveform.evaluate((element) => (element as HTMLCanvasElement).width),
    )
    .toBeLessThan(widthBefore - 20);
  await expect.poll(() => drawnColumns(waveform)).toBeGreaterThan(20);
});

test("video clips keep their filmstrip and border", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropIntoNewSourceTrack(page, VIDEO, "test-pattern.mp4", "video/mp4");
  const span = page.locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  await expect(span.locator(".source-span__filmstrip")).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(span).not.toHaveClass(/source-span--audio/);
  await expect(span.locator("canvas")).toHaveCount(0);

  await copySpanToLayer(span, "Layer 1");
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await expect(clip.locator(".clip-card__filmstrip")).toHaveCount(1);
  await expect(clip).not.toHaveClass(/clip-card--audio/);
  await expect(clip.locator("canvas")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.move(5, 5);
  await expect.poll(() => borderAlpha(clip)).toBe(1);
});
