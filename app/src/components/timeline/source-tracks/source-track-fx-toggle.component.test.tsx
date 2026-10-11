import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  mouse,
  query,
  queryAll,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// The FX button in each source track header (#695), like a layer's (#693):
// lit while the track's FX are on, the default, and turning it off turns
// off the track's own effects and its source clips'. With no layer clips,
// the preview renders the source tracks.

const VIEWPORT = { width: 1600, height: 1200 } as const;

// Ctrl on Linux and Windows, Cmd on macOS, as Playwright's ControlOrMeta.
const MOD = /mac/i.test(navigator.platform) ? "Meta" : "Control";

async function pressMod(key: string) {
  await userEvent.keyboard(`{${MOD}>}${key}{/${MOD}}`);
}

async function addSourceVideo() {
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1);
}

// The preview's pixels, downsampled to a 16×16 grid of RGB values.
async function previewPixels() {
  const base64 = await page.screenshot({
    element: query(".preview-monitor canvas"),
    save: false,
  });
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
}

// The mean per-channel difference between two samples, 0-255.
function difference(a: number[], b: number[]) {
  let sum = 0;
  for (const [index, value] of a.entries()) {
    sum += Math.abs(value - b[index]);
  }
  return sum / a.length;
}

async function expectPreview(expected: number[]) {
  await expect
    .poll(async () => difference(expected, await previewPixels()), {
      timeout: 15_000,
    })
    .toBeLessThan(4);
}

// Waits for the preview to settle on a frame different from `before`, and
// returns it.
async function expectPreviewChange(before: number[]) {
  let after = before;
  await expect
    .poll(
      async () => {
        after = await previewPixels();
        return difference(before, after);
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(4);
  return after;
}

// Focuses a menu item and opens its submenu, as Playwright's press does.
async function openSubmenu(name: string, exact: boolean) {
  const item = page.getByRole("menuitem", { name, exact });
  await expect.element(item).toBeVisible();
  item.element().focus();
  await userEvent.keyboard("{ArrowRight}");
}

// Clip-mode Animation, on for a new device, eases an effect in from the
// clip's start, where the playhead is; switching it off shows the effect
// as set.
async function turnAnimationOff(group: "layer" | "clip") {
  await page
    .elementLocator(query(`.fx-chain [data-fx-group="${group}"]`))
    .getByRole("button", { name: /^Turn Animation Off/ })
    .click();
}

const deviceSelector =
  '.fx-chain :is([data-fx-group="layer"], [data-fx-group="clip"])';

test("a source track's FX button turns its and its clips' effects off and on", async () => {
  await setViewport(VIEWPORT);
  await renderApp();
  await addSourceVideo();
  await expect
    .element(query(".preview-monitor"))
    .toHaveAttribute("data-render-source", "source-tracks");
  await expectCount(".preview-placeholder", 0);
  const labelText = () => query(".track-label--source").textContent ?? "";
  const fx = query(".track-label--source .track-label__fx");
  await expect.element(fx).toBeEnabled();
  await expect.element(fx).toHaveAttribute("aria-pressed", "true");
  await expect.element(fx).toHaveAttribute("title", "Turn test-pattern FX off");
  await expect.poll(labelText).not.toMatch(/FX off/);

  // A Negative Split on the source track and a half-turn Colorize on its
  // clip both render.
  const plain = await previewPixels();
  await userEvent.click(query(".source-span"));
  await page
    .getByRole("button", { name: "Add device to this track", exact: false })
    .first()
    .click();
  await openSubmenu("Stylize", false);
  await page
    .getByRole("menuitem", { name: "Negative Split", exact: false })
    .click();
  await turnAnimationOff("layer");
  const withTrack = await expectPreviewChange(plain);
  await page
    .getByRole("button", { name: "Add device to this clip", exact: false })
    .click();
  await openSubmenu("Color", true);
  await page.getByRole("menuitem", { name: /^Colorize/ }).click();
  await turnAnimationOff("clip");
  const clipDevice = page.elementLocator(
    query('.fx-chain [data-fx-group="clip"]'),
  );
  const hue = clipDevice.getByRole("button", { name: /^Hue Shift: / });
  await expect.element(hue).toBeVisible();
  hue.element().focus();
  await userEvent.keyboard("{Enter}");
  await clipDevice.getByRole("textbox").fill("0.5");
  await userEvent.keyboard("{Enter}");
  const withFx = await expectPreviewChange(withTrack);
  await expectCount(deviceSelector, 2);
  const title = query(".fx-panel__toggle").textContent;

  // Off: the button unlights and both stacks stop rendering. Clicking it
  // leaves the source clip selected.
  await userEvent.click(fx);
  await expect.element(fx).toHaveAttribute("aria-pressed", "false");
  await expect.element(fx).toHaveAttribute("title", "Turn test-pattern FX on");
  await expect.poll(labelText).toMatch(/FX off/);
  await expect
    .poll(() => query(".fx-panel__toggle").textContent)
    .toBe(title ?? "");
  await expect
    .poll(() => document.querySelector(".fx-chain__layer-off")?.textContent)
    .toMatch(/Track FX off/);
  for (const device of queryAll(deviceSelector)) {
    await expect.element(device).toHaveClass(/fx-device-panel--layer-off/);
  }
  await expectPreview(plain);

  // On again: every effect is back as it was.
  await userEvent.click(fx);
  await expect.element(fx).toHaveAttribute("aria-pressed", "true");
  await expect.poll(labelText).not.toMatch(/FX off/);
  for (const device of queryAll(deviceSelector)) {
    await expect.element(device).not.toHaveClass(/fx-device-panel--layer-off/);
  }
  await expectPreview(withFx);

  // Each toggle is one undo step.
  query(".fx-panel__toggle").focus();
  await pressMod("z");
  await expect.element(fx).toHaveAttribute("aria-pressed", "false");
  await expectPreview(plain);
  await pressMod("z");
  await expect.element(fx).toHaveAttribute("aria-pressed", "true");
  await expectPreview(withFx);

  // The FX panel's banner turns the track's FX back on too.
  await userEvent.click(fx);
  await expect.element(fx).toHaveAttribute("aria-pressed", "false");
  await page
    .elementLocator(query(".fx-chain__layer-off"))
    .getByRole("button", { name: "On", exact: false })
    .click();
  await expect.element(fx).toHaveAttribute("aria-pressed", "true");
  await expectPreview(withFx);
}, 120_000);

test("a source track's FX button works while the source tracks are locked", async () => {
  await setViewport(VIEWPORT);
  await renderApp();
  await addSourceVideo();
  await page
    .getByRole("button", { name: "Lock source tracks", exact: false })
    .click();
  await expect
    .element(
      page.getByRole("button", { name: "Unlock source tracks", exact: false }),
    )
    .toBeVisible();

  const fx = query(".track-label--source .track-label__fx");
  await expect.element(fx).toBeEnabled();
  await userEvent.click(fx);
  await expect.element(fx).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(fx);
  await expect.element(fx).toHaveAttribute("aria-pressed", "true");
}, 60_000);

// Plain text like a layer's (#721): amber while on, muted while off, with no
// chip, border or background either way.
test("a source track's FX button is plain text, amber when on and muted when off", async () => {
  await setViewport(VIEWPORT);
  await renderApp();
  await addSourceVideo();
  const fx = query(".track-label--source .track-label__fx");
  const css = (property: string) =>
    getComputedStyle(fx).getPropertyValue(property);
  await mouse.move(0, 0);
  await expect.element(fx).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => css("color")).toBe("rgb(246, 183, 60)");
  await expect.poll(() => css("background-color")).toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => css("border-top-width")).toBe("0px");

  await userEvent.click(fx);
  await mouse.move(0, 0);
  await expect.element(fx).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => css("color")).toBe("rgb(164, 169, 191)");
  await expect.poll(() => css("background-color")).toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => css("border-top-width")).toBe("0px");
}, 60_000);
