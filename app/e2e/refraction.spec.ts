import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Refraction (#823): the layer seen through water or textured glass. It is
// added from the Stylize submenu of a layer's add menu, shows its defaults,
// shows Speed only for Water and Angle only for Reeded Glass, and bends the
// preview when its settings change.

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// Drops the test pattern on a new source track, places it on the
// arrangement and selects its clip.
async function addVideoClip(page: Page) {
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
  // Ctrl/Cmd-click on a source clip drops it on the arrangement.
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.locator(".clip-card").click();
  await expect(page.locator(".clip-card")).toHaveClass(/clip-card--selected/);
}

// The preview's pixels, downsampled to a 16×16 grid of RGB values, read
// from a screenshot so the WebGL canvas needn't keep its drawing buffer.
async function previewPixels(page: Page) {
  const shot = await page
    .locator(".composition-player__canvas")
    .screenshot({ animations: "disabled" });
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

const device = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Refraction"]');

async function typeValue(page: Page, label: string, value: string) {
  // A knob's readout opens its editor on a double-click.
  await device(page)
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device(page).getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

async function pickType(page: Page, type: string) {
  await device(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: type, exact: true }).click();
  await expect(device(page).getByRole("combobox", { name: "Type" })).toHaveText(
    type,
  );
}

test("Refraction is added from Stylize with its defaults and bends the preview", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addVideoClip(page);
  await page.mouse.move(0, 0);
  const plain = await previewPixels(page);

  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menuitem", { name: "Stylize", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Refraction/ }).click();
  await expect(device(page)).toHaveCount(1);
  await device(page)
    .getByRole("button", { name: "Turn Animation Off for Refraction" })
    .click();

  // The defaults: Water, with Speed and no Angle.
  await expect(device(page).getByRole("combobox", { name: "Type" })).toHaveText(
    "Water",
  );
  for (const [label, value] of [
    ["Amount", "30%"],
    ["Scale", "50%"],
    ["Speed", "20%"],
    ["Dispersion", "0%"],
  ]) {
    await expect(
      device(page).getByRole("slider", { name: label }),
    ).toHaveAttribute("aria-valuetext", value);
  }
  await expect(device(page).getByRole("slider", { name: "Angle" })).toHaveCount(
    0,
  );

  // Reeded Glass swaps Speed for Angle, at 90°.
  await pickType(page, "Reeded Glass");
  await expect(device(page).getByRole("slider", { name: "Speed" })).toHaveCount(
    0,
  );
  await expect(
    device(page).getByRole("slider", { name: "Angle" }),
  ).toHaveAttribute("aria-valuetext", "90°");

  // Large glass blocks at full strength bend the gradient visibly.
  await pickType(page, "Glass Blocks");
  await expect(device(page).getByRole("slider", { name: "Angle" })).toHaveCount(
    0,
  );
  await page.mouse.move(0, 0);
  const before = await previewPixels(page);
  await typeValue(page, "Scale", "1");
  await typeValue(page, "Amount", "1");
  await expect(
    device(page).getByRole("slider", { name: "Amount" }),
  ).toHaveAttribute("aria-valuetext", "100%");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(before, await previewPixels(page)), {
      timeout: 15_000,
    })
    .toBeGreaterThan(4);

  // Amount 0 looks straight through the glass.
  await typeValue(page, "Amount", "0");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(plain, await previewPixels(page)), {
      timeout: 15_000,
    })
    .toBeLessThan(1);
});
