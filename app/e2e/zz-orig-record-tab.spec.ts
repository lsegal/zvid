import { expect, type Page, test } from "@playwright/test";

// Kept in Playwright: these keep the Record tab and its inputs across a page
// reload; RecordTab.component.test.tsx covers the rest of the Record tab.
//
// The Media drawer's Record tab picks the default camera and mic to record
// from. Chromium's fake devices stand in for a webcam and a mic.
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

async function pick(page: Page, input: "Video" | "Audio", option: string) {
  await drawer(page)
    .getByRole("combobox", { name: `${input} input` })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the Record tab remembers its inputs and asks for nothing after a reload until shown", async ({
  page,
}) => {
  await countMediaRequests(page);
  await page.goto("/");
  await segment(page, "Record").click();
  await pick(page, "Audio", "None");
  await pick(page, "Video", "None");
  await expect(
    drawer(page).locator(".record-input-picker__video").getByRole("status"),
  ).toHaveText("No video");

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
});

test("the drawer stays open on Record across a reload, and Record closes it", async ({
  page,
}) => {
  await page.goto("/");
  await segment(page, "Record").click();
  await expect(drawer(page)).toBeVisible();
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
