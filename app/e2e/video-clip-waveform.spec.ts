import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Video clips with an audio track, on layers and in source tracks, draw a
// semi-transparent waveform over their filmstrip that never takes the
// pointer. Video without audio draws none. The fixtures are a three-second
// 320×180 test pattern with a tone, and the silent test pattern.
const VIDEO_WITH_AUDIO = new URL(
  "./fixtures/test-pattern-audio.webm",
  import.meta.url,
);
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

// The element the pointer would hit at the middle of a locator's box.
async function hitAtCenter(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("not visible");
  }
  return locator
    .page()
    .evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className ?? "", {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
}

test("video clips with audio draw a waveform over their filmstrip", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropIntoNewSourceTrack(
    page,
    VIDEO_WITH_AUDIO,
    "test-pattern-audio.webm",
    "video/webm",
  );

  // The source clip keeps its frames and draws the waveform over them.
  const span = page.locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  await expect(span.locator(".source-span__filmstrip")).toHaveCount(1, {
    timeout: 30_000,
  });
  const spanOverlay = span.locator("canvas.source-span__waveform-overlay");
  await expect(spanOverlay).toHaveCount(1, { timeout: 30_000 });
  await expect(span).not.toHaveClass(/source-span--audio/);
  await expect.poll(() => drawnColumns(spanOverlay)).toBeGreaterThan(20);
  expect(
    Number(await spanOverlay.evaluate((e) => getComputedStyle(e).opacity)),
  ).toBeLessThan(1);
  expect(await hitAtCenter(spanOverlay)).not.toContain("waveform-overlay");

  // The layer clip too.
  await copySpanToLayer(span, "Layer 1");
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await expect(clip.locator(".clip-card__filmstrip")).toHaveCount(1);
  const overlay = clip.locator("canvas.clip-card__waveform-overlay");
  await expect(overlay).toHaveCount(1, { timeout: 30_000 });
  await expect(clip).not.toHaveClass(/clip-card--audio/);
  await expect.poll(() => drawnColumns(overlay)).toBeGreaterThan(20);
  expect(
    Number(await overlay.evaluate((e) => getComputedStyle(e).opacity)),
  ).toBeLessThan(1);

  // The overlay never takes the pointer: clicks select the clip and drags
  // move it.
  await page.keyboard.press("Escape");
  await clip.evaluate((element) => element.scrollIntoView({ block: "center" }));
  expect(await hitAtCenter(overlay)).not.toContain("waveform-overlay");
  await expect(clip).not.toHaveClass(/clip-card--selected/);
  await clip.click();
  await expect(clip).toHaveClass(/clip-card--selected/);

  const leftBefore = await clip.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.left),
  );
  const box = await clip.boundingBox();
  if (!box) {
    throw new Error("clip is not visible");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() =>
      clip.evaluate((element) =>
        Number.parseFloat((element as HTMLElement).style.left),
      ),
    )
    .toBeGreaterThan(leftBefore + 40);
  await expect.poll(() => drawnColumns(overlay)).toBeGreaterThan(20);
});

test("video clips without audio draw no waveform", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropIntoNewSourceTrack(page, VIDEO, "test-pattern.mp4", "video/mp4");
  const span = page.locator(".source-span");
  await expect(span).toHaveCount(1, { timeout: 30_000 });
  await expect(span.locator(".source-span__filmstrip")).toHaveCount(1, {
    timeout: 30_000,
  });

  await copySpanToLayer(span, "Layer 1");
  const clip = lane(page, "1").locator(".clip-card");
  await expect(clip).toHaveCount(1);
  await expect(clip.locator(".clip-card__filmstrip")).toHaveCount(1);
  // Give a decode the time it would need before checking nothing appeared.
  await page.waitForTimeout(1000);
  await expect(span.locator("canvas")).toHaveCount(0);
  await expect(clip.locator("canvas")).toHaveCount(0);
  await expect(clip).not.toHaveClass(/clip-card--waveform-overlay/);
});
