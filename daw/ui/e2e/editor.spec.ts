import { expect, type Page, test } from "@playwright/test";
import type {} from "../src/web/start.ts";

/** The header's status text. */
const statusLabel = (page: Page) => page.locator("h1.status-label");

/** Opens the editor on the web driver with these query options. */
async function open(page: Page, query = "manual-transport") {
  await page.goto(`/?${query}`);
  await expect(statusLabel(page)).toBeVisible();
}

async function chooseCamera(page: Page, name: string) {
  await page
    .getByRole("button", { name: /camera/i })
    .first()
    .click();
  await page
    .getByRole("listbox", { name: "Cameras" })
    .getByRole("option", { name: new RegExp(name) })
    .click();
}

/** Plays or stops the driver's simulated transport. */
async function setPlaying(page: Page, playing: boolean) {
  await page.evaluate(
    (playing) => window.__ZVID_DRIVER__?.backend.setPlaying(playing),
    playing,
  );
}

test("starts with no camera and the saved takes", async ({ page }) => {
  await open(page);
  await expect(statusLabel(page)).toHaveText("No camera");
  await expect(page.getByText("No camera selected")).toBeVisible();
  await expect(page.getByText("Takes (3)")).toBeVisible();
  await expect(page.getByText("File missing")).toHaveCount(1);
  await expect(page.getByText("Not placed")).toHaveCount(1);
  await expect(page.getByText("Bar 17.1.1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("previews the chosen camera", async ({ page }) => {
  await open(page);
  await chooseCamera(page, "Logitech BRIO");
  await expect(statusLabel(page)).toHaveText("Ready to capture");
  await expect(page.getByAltText("Live camera preview")).toBeVisible();
  await expect(page.locator("footer")).toContainText(
    "Logitech BRIO · 3840×2160",
  );
});

test("shows a rotated camera's portrait size", async ({ page }) => {
  await open(page);
  await chooseCamera(page, "Elgato Facecam");
  await expect(page.getByAltText("Live camera preview")).toBeVisible();
  await expect(page.locator("footer")).toContainText(
    "Elgato Facecam (portrait) · 1080×1920",
  );
  await chooseCamera(page, "FaceTime HD Camera");
  await expect(page.locator("footer")).toContainText(
    "FaceTime HD Camera · 1920×1080",
  );
});

test("records takes that follow the transport", async ({ page }) => {
  await open(page, "manual-transport&takes=none");
  await expect(page.getByText("Your takes will show up here")).toBeVisible();
  await chooseCamera(page, "FaceTime HD Camera");
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByRole("timer", { name: "Capture time" })).toBeVisible();
  await expect(page.getByText("Takes follow transport: 0")).toBeVisible();

  await setPlaying(page, true);
  await expect(page.getByText("Takes follow transport: 1")).toBeVisible();
  await setPlaying(page, false);
  await expect(page.getByText("Takes (1)")).toBeVisible();

  await setPlaying(page, true);
  await page.getByRole("button", { name: "Stop capturing" }).click();
  await expect(statusLabel(page)).toHaveText("Ready to capture");
  await expect(page.getByText("Takes (2)")).toBeVisible();
  await expect(page.getByText("Bar 17.1.1")).toBeVisible();
});

test("explains a camera without permission", async ({ page }) => {
  await open(page);
  await chooseCamera(page, "Studio Display Camera");
  await expect(page.getByRole("alert")).toContainText(
    "Camera access is off for Ableton Live.",
  );
  await page.getByRole("button", { name: "Open Privacy Settings" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__ZVID_DRIVER__?.desktop))
    .toEqual([{ action: "openPrivacySettings" }]);
});

test("points Windows users to Settings", async ({ page }) => {
  await open(page, "manual-transport&platform=windows");
  await chooseCamera(page, "Studio Display Camera");
  await expect(page.getByRole("alert")).toContainText(
    "Settings › Privacy & security › Camera",
  );
  await expect(
    page.getByRole("button", { name: /in File Explorer$/ }).first(),
  ).toBeVisible();
});

test("refreshes devices for a camera in use", async ({ page }) => {
  await open(page);
  await chooseCamera(page, "OBS Virtual Camera");
  await expect(page.getByRole("alert")).toContainText(
    "This camera is in use by another app.",
  );
  await page.getByRole("button", { name: "Refresh devices" }).click();
  await chooseCamera(page, "Pixel 8");
  await expect(page.locator("footer")).toContainText(
    "Pixel 8 (Link to Windows) · 1080×1920",
  );
});

test("reveals a take in the file manager", async ({ page }) => {
  await open(page);
  await page
    .getByRole("button", { name: /^Show take from .* in Finder$/ })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__ZVID_DRIVER__?.desktop))
    .toEqual([{ action: "revealTake", id: "demo-1" }]);
});

test("installs the Live companion", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Install Live companion" }).click();
  await expect(page.getByText(/^Live companion installed\./)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__ZVID_DRIVER__?.desktop))
    .toEqual([{ action: "installLiveScript" }]);
});

test("follows Live's record buttons", async ({ page }) => {
  await open(page);
  await chooseCamera(page, "FaceTime HD Camera");
  await page.evaluate(() =>
    window.__ZVID_DRIVER__?.backend.setLive({ recordArmed: false }),
  );
  await expect(page.getByText("Following Live's record button")).toBeVisible();
  await expect(page.getByText("Record off in Live")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record" })).toHaveCount(0);
  await page.evaluate(() =>
    window.__ZVID_DRIVER__?.backend.setLive({ recordArmed: true }),
  );
  await expect(page.getByText("Record on in Live")).toBeVisible();
});
