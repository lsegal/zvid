import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The preview's Scopes pane (#1152): a Scopes button beside the
// Audio/Video badge opens Lumetri-style scopes of the composited program
// frame, or of the Media tab's media, over the bottom of the picture.

// Room for a picture above the Media tab's transport.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
});

const VIDEO_FILE = {
  url: new URL("./fixtures/test-pattern-audio.webm", import.meta.url),
  name: "test-pattern-audio.webm",
  type: "video/webm",
};
const AUDIO_FILE = {
  url: new URL("./fixtures/tone.wav", import.meta.url),
  name: "tone.wav",
  type: "audio/wav",
};

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a fill clip on Layer 1, selected, and moves the playhead to its
// middle, where it is fully drawn.
async function insertFillAtStart(page: Page) {
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, y, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();
  const fill = lane(page, "1").locator(".clip-card--fill");
  await expect(fill).toHaveClass(/clip-card--selected/);
  const clip = await fill.boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
}

async function dropIntoNewSourceTrack(page: Page) {
  const files = await Promise.all(
    [VIDEO_FILE, AUDIO_FILE].map(async ({ url, name, type }) => ({
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
  await expect(page.locator(".source-span")).toHaveCount(2, {
    timeout: 30_000,
  });
}

const scopesButton = (page: Page) =>
  page
    .locator(".preview-panel__header")
    .getByRole("button", { name: "Scopes", exact: true });
const scopesPane = (page: Page) =>
  page.getByRole("region", { name: "Scopes", exact: true });
const scopesCanvas = (page: Page) =>
  scopesPane(page).locator(".scopes-pane__canvas");

// How many of the scope's pixels are lit brighter than its graticule, and
// the mean height of those, 0 at the bottom and 1 at the top.
async function readScope(page: Page) {
  return scopesCanvas(page).evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D context");
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    let heights = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (Math.max(data[index], data[index + 1], data[index + 2]) > 200) {
        lit++;
        heights += 1 - Math.floor(index / 4 / canvas.width) / canvas.height;
      }
    }
    return { lit, height: lit ? heights / lit : 0, image: canvas.toDataURL() };
  });
}

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`${selector} is not visible`);
  }
  return box;
}

test("the Scopes button opens a resizable pane of the composited program frame", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page);

  // Right-aligned, just left of the Audio/Video badge.
  const button = scopesButton(page);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  const mode = await boxOf(page, ".preview-panel__mode");
  const buttonBox = await button.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox?.x ?? 0).toBeLessThan(mode.x);
  expect(mode.x - ((buttonBox?.x ?? 0) + (buttonBox?.width ?? 0))).toBeLessThan(
    24,
  );

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(scopesPane(page)).toBeVisible();

  // Over the bottom half of the monitor.
  const monitor = await boxOf(page, ".preview-monitor");
  const pane = await boxOf(page, ".scopes-pane");
  expect(
    Math.abs(pane.y + pane.height - (monitor.y + monitor.height)),
  ).toBeLessThan(1.5);
  expect(Math.abs(pane.height - monitor.height / 2)).toBeLessThan(3);

  // It draws the program frame's waveform.
  await expect(scopesCanvas(page)).toHaveAttribute("data-sampled", "true");
  await expect.poll(async () => (await readScope(page)).lit).toBeGreaterThan(0);
  const plain = await readScope(page);

  // The scopes follow the composited picture, effects included: two stops
  // of Exposure on the layer raise the trace.
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Color", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Exposure/ }).click();
  const exposure = page.locator('.fx-chain section[aria-label="Exposure"]');
  await exposure.getByRole("button", { name: /^Exposure: / }).dblclick();
  const input = exposure.getByRole("textbox", { name: "Exposure value" });
  await input.fill("2");
  await input.press("Enter");
  await expect
    .poll(async () => (await readScope(page)).height)
    .toBeGreaterThan(plain.height + 0.05);

  // Each scope draws something different.
  const waveform = (await readScope(page)).image;
  for (const name of ["Parade", "Vectorscope", "Histogram"]) {
    await scopesPane(page).getByRole("button", { name, exact: true }).click();
    await expect(scopesCanvas(page)).toHaveAttribute("aria-label", name);
    await expect
      .poll(async () => (await readScope(page)).image)
      .not.toBe(waveform);
  }

  // Dragging the top edge up makes the pane taller, up to its maximum.
  const edge = scopesPane(page).getByRole("separator", {
    name: "Resize scopes",
  });
  const edgeBox = await edge.boundingBox();
  if (!edgeBox) {
    throw new Error("The resize edge is not visible");
  }
  const x = edgeBox.x + edgeBox.width / 2;
  const y = edgeBox.y + edgeBox.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 4 });
  await page.mouse.up();
  const taller = await boxOf(page, ".scopes-pane");
  expect(Math.abs(taller.height - (pane.height + 40))).toBeLessThan(3);
  await page.mouse.move(x, y - 40);
  await page.mouse.down();
  await page.mouse.move(x, monitor.y - 200, { steps: 4 });
  await page.mouse.up();
  const tallest = await boxOf(page, ".scopes-pane");
  expect(Math.abs(tallest.height - monitor.height * 0.9)).toBeLessThan(3);

  // Clicking the button again closes it.
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(scopesPane(page)).toHaveCount(0);
});

test("the Scopes pane follows the Media tab and shows an empty state for audio", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropIntoNewSourceTrack(page);
  await page.getByRole("button", { name: "Media", exact: true }).click();
  const media = (name: string) =>
    page.getByRole("option").filter({ hasText: name });

  await media("test-pattern-audio").dblclick();
  await expect(page.locator(".media-preview video")).toBeVisible();
  await scopesButton(page).click();

  // The pane covers the media's picture, not its transport.
  await expect(scopesPane(page)).toBeVisible();
  const picture = await boxOf(page, ".media-preview__picture");
  const pane = await boxOf(page, ".scopes-pane");
  expect(
    Math.abs(pane.y + pane.height - (picture.y + picture.height)),
  ).toBeLessThan(1.5);
  await expect(
    page.getByRole("button", { name: "Play media" }),
  ).toBeInViewport();
  await expect(scopesCanvas(page)).toHaveAttribute("data-sampled", "true");
  await expect.poll(async () => (await readScope(page)).lit).toBeGreaterThan(0);

  // Scrubbing the media updates the scopes.
  const before = (await readScope(page)).image;
  await page.getByRole("slider", { name: "Media position" }).fill("2");
  await expect.poll(async () => (await readScope(page)).image).not.toBe(before);

  // Audio-only media has no picture.
  await media("tone").dblclick();
  await expect(page.locator(".preview-panel__title")).toHaveText("tone.wav");
  await expect(scopesPane(page)).toContainText(
    "Audio only: there is no picture to analyze.",
  );
  await expect(scopesCanvas(page)).toBeHidden();

  // The Timeline tab shows the program frame, with the pane still open.
  await page
    .getByRole("tablist", { name: "Preview" })
    .getByRole("tab", { name: "Timeline", exact: true })
    .click();
  await expect(scopesPane(page)).toBeVisible();
  await expect(scopesCanvas(page)).toBeVisible();
  await expect(scopesCanvas(page)).toHaveAttribute("data-sampled", "true");
});
