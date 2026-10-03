import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Selecting a source track, or one of its clips, leads the Effects pane
// with a Record device, ahead of the Clip device and the Global section:
// collapsed by default, expanded while the track is armed, holding the
// track's own Video and Audio inputs.
// Chromium's fake camera and microphone stand in for real devices.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["camera", "microphone"],
});

async function left(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no bounding box");
  return box.x;
}

async function dropVideo(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[aria-label="Source track drop area"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
}

// Asserts each of the parts lies within the container's content box, inside
// its padding.
async function expectInside(container: Locator, parts: Locator[]) {
  const content = await container.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const inset = (side: string) =>
      Number.parseFloat(style.getPropertyValue(`padding-${side}`)) +
      Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
    return {
      left: box.left + inset("left"),
      right: box.right - inset("right"),
    };
  });
  for (const part of parts) {
    const box = await part.evaluate((element) => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    });
    expect(box.left).toBeGreaterThanOrEqual(content.left - 0.5);
    expect(box.right).toBeLessThanOrEqual(content.right + 0.5);
  }
}

test("a source track's Record device folds, arms and overrides its inputs", async ({
  page,
}) => {
  await page.goto("/");
  await dropVideo(page);
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });

  // Selecting the track shows the device collapsed, first in the chain.
  await page.locator(".track-label--source").click();
  const device = page.locator(".track-record-device");
  await expect(device).toHaveCount(1);
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);
  const arm = device.getByRole("button", { name: /^Arm .+ for recording$/ });
  await expect(arm).toHaveAttribute("aria-pressed", "false");
  const chain = page.locator(".fx-chain");
  await expect(chain.locator(":scope > *").first()).toHaveClass(
    /track-record-device/,
  );
  const global = page.locator('.fx-chain [data-fx-divider="global"]');
  expect(await left(device)).toBeLessThan(await left(global));

  // Arming expands it, with the track's inputs on their defaults and live
  // previews.
  await arm.click();
  await expect(device).not.toHaveClass(/fx-device-panel--collapsed/);
  const disarm = device.getByRole("button", { name: /^Disarm / });
  await expect(disarm).toHaveAttribute("aria-pressed", "true");
  // The track handle's arm button follows, and arms the device back.
  const handleArm = page.locator(".track-label__arm");
  await expect(handleArm).toHaveAttribute("aria-pressed", "true");
  await handleArm.click();
  await expect(arm).toHaveAttribute("aria-pressed", "false");
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);
  await handleArm.click();
  await expect(disarm).toHaveAttribute("aria-pressed", "true");
  await expect(device).not.toHaveClass(/fx-device-panel--collapsed/);
  const videoInput = device.getByRole("combobox", { name: "Video input" });
  const audioInput = device.getByRole("combobox", { name: "Audio input" });
  await expect(videoInput).toHaveText(/^Default \(.+\)$/);
  await expect(audioInput).toHaveText(/^Default \(.+\)$/);
  const preview = device.getByLabel("Camera preview");
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).videoWidth),
    )
    .toBeGreaterThan(0);
  await expect(device.locator(".vu-meter")).toBeVisible();
  // The dropdowns and the meter stay inside the device's padding, even with
  // the fake microphone's long "Default (Fake Default Audio Input)" label.
  await expectInside(device.locator(".track-record-device__body"), [
    videoInput,
    audioInput,
    device.locator(".vu-meter"),
  ]);

  // None overrides the camera for this track and turns its preview off.
  await videoInput.click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await expect(videoInput).toHaveText("None");
  await expect(device.getByText("No video")).toBeVisible();
  const saved = await page.evaluate(() =>
    localStorage.getItem("zvid-record-track-inputs"),
  );
  expect(Object.values(JSON.parse(saved ?? "{}"))).toEqual([{ video: null }]);

  // Default clears the override again.
  await videoInput.click();
  await page.getByRole("option", { name: /^Default \(/ }).click();
  await expect(videoInput).toHaveText(/^Default \(.+\)$/);
  await expect(device.getByText("No video")).toHaveCount(0);

  // Selecting the track's clip keeps the device and its arm state.
  await page.locator(".source-span").click();
  // Record still comes first, left of the Clip device, which is left of the
  // Global divider.
  const clip = page.locator(".source-clip-properties");
  await expect(clip).toHaveCount(1);
  await expect(chain.locator(":scope > *").first()).toHaveClass(
    /track-record-device/,
  );
  const clipLeft = await left(clip);
  expect(await left(device)).toBeLessThan(clipLeft);
  expect(clipLeft).toBeLessThan(await left(global));
  await expect(device).not.toHaveClass(/fx-device-panel--collapsed/);
  await expect(disarm).toHaveAttribute("aria-pressed", "true");

  // Disarming folds it, and the previews stop.
  await disarm.click();
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);
  await expect(device.getByLabel("Camera preview")).toHaveCount(0);

  // Expanded by hand, it stays expanded through arming and disarming.
  await device.getByRole("button", { name: "Expand Record" }).click();
  await device.getByRole("button", { name: /^Arm / }).click();
  await device.getByRole("button", { name: /^Disarm / }).click();
  await expect(device).not.toHaveClass(/fx-device-panel--collapsed/);
  await device.getByRole("button", { name: "Collapse Record" }).click();
  await expect(device).toHaveClass(/fx-device-panel--collapsed/);
});
