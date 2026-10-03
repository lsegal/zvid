import { expect, type Page, test } from "@playwright/test";

// The Media drawer's Record tab picks the default camera and mic to record
// from, with a live camera preview and an input meter. Chromium's fake
// devices stand in for a webcam and a mic.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["camera", "microphone"],
});

// Counts camera and mic requests, so a test can tell none were made.
async function countMediaRequests(page: Page) {
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const getUserMedia = devices.getUserMedia.bind(devices);
    (window as unknown as { mediaRequests: number }).mediaRequests = 0;
    devices.getUserMedia = (constraints) => {
      (window as unknown as { mediaRequests: number }).mediaRequests += 1;
      return getUserMedia(constraints);
    };
  });
}

function mediaRequests(page: Page) {
  return page.evaluate(
    () => (window as unknown as { mediaRequests: number }).mediaRequests,
  );
}

function drawer(page: Page) {
  return page.getByRole("complementary", { name: "Media" });
}

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(drawer(page)).toBeVisible();
}

async function pick(page: Page, input: "Video" | "Audio", option: string) {
  await drawer(page)
    .getByRole("combobox", { name: `${input} input` })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the Record tab previews the default inputs and remembers them", async ({
  page,
}) => {
  await countMediaRequests(page);
  await page.goto("/");
  await openDrawer(page);
  await expect(
    drawer(page).getByRole("tab", { name: "Media" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await mediaRequests(page)).toBe(0);

  await drawer(page).getByRole("tab", { name: "Record" }).click();
  await expect(
    drawer(page).getByRole("heading", { name: "Record" }),
  ).toBeVisible();
  await expect(drawer(page)).toContainText("Configure your record inputs");
  await expect(drawer(page).getByRole("button", { name: "List" })).toHaveCount(
    0,
  );

  // The camera plays in the preview and the mic moves the meter.
  const video = drawer(page).getByLabel("Camera preview");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.videoWidth),
    )
    .toBeGreaterThan(0);
  const meter = drawer(page).locator(".record-input-picker__audio");
  await expect
    .poll(async () =>
      Number(
        await meter
          .getByRole("meter", { name: "Left level" })
          .getAttribute("aria-valuenow"),
      ),
    )
    .toBeGreaterThan(-60);
  expect(await mediaRequests(page)).toBeGreaterThan(0);

  // Once access is granted the dropdown lists the cameras by name.
  await pick(page, "Video", "fake_device_0");
  await expect(
    drawer(page).getByRole("combobox", { name: "Video input" }),
  ).toHaveText("fake_device_0");
  await pick(page, "Audio", "None");
  await expect(meter.getByRole("status")).toHaveText("No audio");
  await pick(page, "Video", "None");
  await expect(
    drawer(page).locator(".record-input-picker__video").getByRole("status"),
  ).toHaveText("No video");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.srcObject),
    )
    .toBeNull();

  // Reloaded, the drawer is back on the Record tab and asks for nothing
  // until the inputs are shown; None is still picked.
  await page.reload();
  await expect(
    drawer(page).getByRole("tab", { name: "Record" }),
  ).toHaveAttribute("aria-selected", "true");
  await drawer(page).getByRole("button", { name: "Show Inputs" }).click();
  await expect(
    drawer(page).getByRole("combobox", { name: "Video input" }),
  ).toHaveText("None");
  await expect(
    drawer(page).getByRole("combobox", { name: "Audio input" }),
  ).toHaveText("None");
  expect(await mediaRequests(page)).toBe(0);

  // Closing the drawer releases the camera.
  await pick(page, "Video", "fake_device_0");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.videoWidth),
    )
    .toBeGreaterThan(0);
  await drawer(page)
    .getByRole("button", { name: "Close media drawer" })
    .click();
  await expect(page.locator(".record-input-picker")).toHaveCount(0);
});

test("a saved camera that is gone falls back to the system default", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("zvid-record-video-input", JSON.stringify("gone"));
    localStorage.setItem("zvid-record-audio-input", "null");
  });
  await page.goto("/");
  await openDrawer(page);
  await drawer(page).getByRole("tab", { name: "Record" }).click();
  await expect(
    drawer(page).getByRole("combobox", { name: "Video input" }),
  ).toHaveText(/^System default/);
  await expect
    .poll(() =>
      drawer(page)
        .getByLabel("Camera preview")
        .evaluate((element: HTMLVideoElement) => element.videoWidth),
    )
    .toBeGreaterThan(0);
});

test("denied camera access shows why and keeps None picked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto("/");
  await openDrawer(page);
  await drawer(page).getByRole("tab", { name: "Record" }).click();
  await expect(drawer(page).getByRole("alert").first()).toContainText(
    "access was denied",
  );
  await expect(
    drawer(page).getByRole("combobox", { name: "Video input" }),
  ).toHaveText("None");
  await expect(
    drawer(page).getByRole("combobox", { name: "Audio input" }),
  ).toHaveText("None");
});
