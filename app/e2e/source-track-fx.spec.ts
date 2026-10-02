import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Source tracks and source clips have their own effect stacks. Selecting a
// source clip shows its Clip Properties, then the Global, Track and Clip
// sections; selecting a source track shows Global and Track. With no layer
// clips, the preview renders the source tracks with those stacks.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });

async function addSourceVideo(page: Page) {
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
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// The preview's pixels, downsampled to a 16×16 grid of RGB values.
async function previewPixels(page: Page) {
  const shot = await page
    .locator(".preview-monitor canvas")
    .first()
    .screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D context");
    context.drawImage(image, 0, 0, 16, 16);
    return Array.from(context.getImageData(0, 0, 16, 16).data).filter(
      (_, index) => index % 4 !== 3,
    );
  }, shot.toString("base64"));
}

// The mean per-channel difference between two samples, 0-255.
function difference(a: number[], b: number[]) {
  let sum = 0;
  for (const [index, value] of a.entries()) {
    sum += Math.abs(value - b[index]);
  }
  return sum / a.length;
}

// Waits for the preview to settle on a frame different from `before`, and
// returns it.
async function expectPreviewChange(page: Page, before: number[]) {
  let after = before;
  await expect
    .poll(
      async () => {
        after = await previewPixels(page);
        return difference(before, after);
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(4);
  return after;
}

async function addDevice(button: Locator, page: Page, name: string) {
  await button.click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
}

// Clip-mode Animation, on for a new device, eases an effect in from the
// clip's start, where the playhead is; switching it off shows the effect
// as set.
async function turnAnimationOff(page: Page, group: "layer" | "clip") {
  await page
    .locator(`.fx-chain [data-fx-group="${group}"]`)
    .getByRole("button", { name: /^Turn Animation Off/ })
    .click();
}

const dividers = ".fx-chain [data-fx-divider]";

test("source tracks and clips have their own effects, rendered in the preview", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceVideo(page);
  await expect(page.locator(".preview-monitor")).toHaveAttribute(
    "data-render-source",
    "source-tracks",
  );
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  // A dropped file names its new source track.
  const trackName = "test-pattern";

  // A source track shows Global and its own Track stack.
  await page.locator(".track-label--source").click();
  await expect(page.locator(dividers)).toHaveText(["Global", "Track"]);
  await expect(page.locator(".fx-panel__toggle")).toHaveText(
    `${trackName} Effects`,
  );
  await expect(page.locator(".source-clip-properties")).toHaveCount(0);
  // An empty Track section shows the same compact add tile as the others.
  await expect(page.locator(".fx-chain__empty")).toHaveCount(0);
  await expect(
    page.locator('.fx-chain [data-fx-focus="add-layer"]'),
  ).toBeVisible();

  // An effect on the source track renders on it.
  const plain = await previewPixels(page);
  await page
    .getByRole("button", { name: "Add device to this track" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  // The track's menu offers a layer's effects: Transform but not Order.
  await expect(menu.getByRole("menuitem", { name: "Transform" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Order/ })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Negative Split" }).click();
  await expect(page.locator('.fx-chain [data-fx-group="layer"]')).toHaveCount(
    1,
  );
  await turnAnimationOff(page, "layer");
  const withTrack = await expectPreviewChange(page, plain);

  // A source clip shows its Clip Properties, then Global, Track and Clip.
  await page.locator(".source-span").click();
  await expect(page.locator(".fx-panel__toggle")).toHaveText(
    new RegExp(`^Clip .+ Effects \\(${trackName}\\)$`),
  );
  const chain = page.locator(".fx-chain");
  await expect(chain.locator(":scope > *").first()).toHaveClass(
    /source-clip-properties/,
  );
  await expect(page.locator(dividers)).toHaveText(["Global", "Track", "Clip"]);
  const order = await chain.evaluate((element) => {
    const properties = element.querySelector(".source-clip-properties");
    const global = element.querySelector('[data-fx-divider="global"]');
    if (!properties || !global) return false;
    return Boolean(
      properties.compareDocumentPosition(global) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(order).toBe(true);
  // The track's effect shows in the Track section.
  await expect(page.locator('.fx-chain [data-fx-group="layer"]')).toHaveCount(
    1,
  );

  // An effect on the source clip renders too, along with the track's: half
  // a turn of hue on the test pattern's colors.
  await addDevice(
    page.getByRole("button", { name: "Add device to this clip" }),
    page,
    "Colorize",
  );
  await expect(page.locator('.fx-chain [data-fx-group="clip"]')).toHaveCount(1);
  await turnAnimationOff(page, "clip");
  const clipDevice = page.locator('.fx-chain [data-fx-group="clip"]');
  await clipDevice.getByRole("button", { name: /^Hue Shift: / }).focus();
  await page.keyboard.press("Enter");
  await clipDevice.getByRole("textbox").fill("0.5");
  await page.keyboard.press("Enter");
  await expect(
    clipDevice.getByRole("button", { name: "Hue Shift: +180°. Edit value" }),
  ).toBeVisible();
  await expectPreviewChange(page, withTrack);

  // Undo removes the clip's effect (after its Hue Shift and Animation edits),
  // leaving the track's.
  await page.locator(".fx-panel__toggle").focus();
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press("ControlOrMeta+z");
  }
  await expect(page.locator('.fx-chain [data-fx-group="clip"]')).toHaveCount(0);
  await expect(page.locator('.fx-chain [data-fx-group="layer"]')).toHaveCount(
    1,
  );
  await expect
    .poll(async () => difference(withTrack, await previewPixels(page)), {
      timeout: 15_000,
    })
    .toBeLessThan(4);
});
