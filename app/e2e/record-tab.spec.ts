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

// The toolbar's Media | Record switch above the timeline.
function segment(page: Page, name: "Media" | "Record") {
  return page
    .getByRole("group", { name: "Media drawer" })
    .getByRole("button", { name, exact: true });
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
  await expect(segment(page, "Media")).toHaveAttribute("aria-expanded", "true");
  expect(await mediaRequests(page)).toBe(0);

  await segment(page, "Record").click();
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
  await expect(segment(page, "Record")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
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
  await segment(page, "Record").click();
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
  await segment(page, "Record").click();
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

test("the toolbar's Media | Record switch opens, switches and closes the drawer", async ({
  page,
}) => {
  await page.goto("/");
  await expect(drawer(page)).toBeHidden();
  await expect(segment(page, "Media")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(segment(page, "Record")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // The drawer has no tab switch of its own.
  await expect(page.getByRole("tab", { name: "Record" })).toHaveCount(0);

  // Record opens the drawer on the Record tab and asks for the inputs.
  await segment(page, "Record").click();
  await expect(drawer(page)).toBeVisible();
  await expect(
    drawer(page).getByRole("heading", { name: "Record" }),
  ).toBeVisible();
  await expect(drawer(page).getByLabel("Camera preview")).toBeVisible();
  await expect(segment(page, "Record")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(segment(page, "Record")).toHaveClass(/is-active/);
  await expect(segment(page, "Media")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Media switches to the Media tab with its view switch and search.
  await segment(page, "Media").click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toContainText("No media yet");
  await expect(
    drawer(page).getByRole("button", { name: "List" }),
  ).toBeVisible();
  await expect(
    drawer(page).getByRole("textbox", { name: "Search media" }),
  ).toBeVisible();
  await expect(segment(page, "Media")).toHaveAttribute("aria-expanded", "true");
  await expect(segment(page, "Record")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Clicking the active segment closes the drawer.
  await segment(page, "Media").click();
  await expect(drawer(page)).toBeHidden();
  await expect(segment(page, "Media")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Reloaded, the drawer is still open on Record, and Record closes it.
  await segment(page, "Record").click();
  await page.reload();
  await expect(drawer(page)).toBeVisible();
  await expect(segment(page, "Record")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await segment(page, "Record").click();
  await expect(drawer(page)).toBeHidden();
  await expect(segment(page, "Record")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("the Record tab puts the close button on the title row", async ({
  page,
}) => {
  await page.goto("/");
  await openDrawer(page);
  await segment(page, "Record").click();

  const heading = drawer(page).getByRole("heading", { name: "Record" });
  const close = drawer(page).getByRole("button", {
    name: "Close media drawer",
  });
  await expect(heading).toBeVisible();
  await expect(close).toHaveCount(1);
  const headingBox = await heading.boundingBox();
  const closeBox = await close.boundingBox();
  if (!headingBox || !closeBox) {
    throw new Error("Expected the heading and close button to be laid out");
  }
  // Their vertical ranges overlap: one row, with nothing above the title.
  expect(closeBox.y).toBeLessThan(headingBox.y + headingBox.height);
  expect(headingBox.y).toBeLessThan(closeBox.y + closeBox.height);
  expect(closeBox.x).toBeGreaterThan(headingBox.x + headingBox.width);

  await close.click();
  await expect(drawer(page)).toBeHidden();
});
