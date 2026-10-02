import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The FX button in each source track header (#695), like a layer's (#693):
// lit while the track's FX are on, the default, and turning it off turns
// off the track's own effects and its source clips'. With no layer clips,
// the preview renders the source tracks.
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

async function expectPreview(page: Page, expected: number[]) {
  await expect
    .poll(async () => difference(expected, await previewPixels(page)), {
      timeout: 15_000,
    })
    .toBeLessThan(4);
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

// Clip-mode Animation, on for a new device, eases an effect in from the
// clip's start, where the playhead is; switching it off shows the effect
// as set.
async function turnAnimationOff(page: Page, group: "layer" | "clip") {
  await page
    .locator(`.fx-chain [data-fx-group="${group}"]`)
    .getByRole("button", { name: /^Turn Animation Off/ })
    .click();
}

test("a source track's FX button turns its and its clips' effects off and on", async ({
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
  const label = page.locator(".track-label--source");
  const fx = label.locator(".track-label__fx");
  await expect(fx).toBeEnabled();
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expect(fx).toHaveAttribute("title", "Turn test-pattern FX off");
  await expect(label).not.toContainText("FX off");

  // A Negative Split on the source track and a half-turn Colorize on its
  // clip both render.
  const plain = await previewPixels(page);
  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this track" })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Negative Split" }).click();
  await turnAnimationOff(page, "layer");
  const withTrack = await expectPreviewChange(page, plain);
  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page.getByRole("menuitem", { name: /^Colorize/ }).click();
  await turnAnimationOff(page, "clip");
  const clipDevice = page.locator('.fx-chain [data-fx-group="clip"]');
  await clipDevice.getByRole("button", { name: /^Hue Shift: / }).focus();
  await page.keyboard.press("Enter");
  await clipDevice.getByRole("textbox").fill("0.5");
  await page.keyboard.press("Enter");
  const withFx = await expectPreviewChange(page, withTrack);
  const devices = page.locator(
    '.fx-chain :is([data-fx-group="layer"], [data-fx-group="clip"])',
  );
  await expect(devices).toHaveCount(2);
  const title = await page.locator(".fx-panel__toggle").textContent();

  // Off: the button unlights and both stacks stop rendering. Clicking it
  // leaves the source clip selected.
  await fx.click();
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await expect(fx).toHaveAttribute("title", "Turn test-pattern FX on");
  await expect(label).toContainText("FX off");
  await expect(page.locator(".fx-panel__toggle")).toHaveText(title ?? "");
  await expect(page.locator(".fx-chain__layer-off")).toHaveText(/Track FX off/);
  for (const device of await devices.all()) {
    await expect(device).toHaveClass(/fx-device-panel--layer-off/);
  }
  await expectPreview(page, plain);

  // On again: every effect is back as it was.
  await fx.click();
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expect(label).not.toContainText("FX off");
  for (const device of await devices.all()) {
    await expect(device).not.toHaveClass(/fx-device-panel--layer-off/);
  }
  await expectPreview(page, withFx);

  // Each toggle is one undo step.
  await page.locator(".fx-panel__toggle").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await expectPreview(page, plain);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expectPreview(page, withFx);

  // The FX panel's banner turns the track's FX back on too.
  await fx.click();
  await page
    .locator(".fx-chain__layer-off")
    .getByRole("button", { name: "On" })
    .click();
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expectPreview(page, withFx);
});

test("a source track's FX button works while the source tracks are locked", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceVideo(page);
  await page.getByRole("button", { name: "Lock source tracks" }).click();
  await expect(
    page.getByRole("button", { name: "Unlock source tracks" }),
  ).toBeVisible();

  const fx = page.locator(".track-label--source .track-label__fx");
  await expect(fx).toBeEnabled();
  await fx.click();
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await fx.click();
  await expect(fx).toHaveAttribute("aria-pressed", "true");
});

// Plain text like a layer's (#721): amber while on, muted while off, with no
// chip, border or background either way.
test("a source track's FX button is plain text, amber when on and muted when off", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceVideo(page);
  const fx = page.locator(".track-label--source .track-label__fx");
  await page.mouse.move(0, 0);
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expect(fx).toHaveCSS("color", "rgb(246, 183, 60)");
  await expect(fx).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(fx).toHaveCSS("border-top-width", "0px");

  await fx.click();
  await page.mouse.move(0, 0);
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await expect(fx).toHaveCSS("color", "rgb(164, 169, 191)");
  await expect(fx).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(fx).toHaveCSS("border-top-width", "0px");
});
